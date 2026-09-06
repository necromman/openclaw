package team.prost.ixauth.security;

import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.config.DbDialect;

/**
 * 속도 제한 카운터를 <b>공용 DB</b>에 두는 저장소 (G26).
 *
 * <p>인스턴스를 여러 개 띄우면 메모리 카운터는 인스턴스별이라 실질 한도가 배수가 된다.
 * 한 곳에서 세려면 공유 저장소가 필요한데, 전용 Redis 를 두지 않는 것이 설계 불변식 3
 * 이므로 이미 쓰고 있는 앱 DB 를 쓴다.</p>
 *
 * <p><b>정확한 쿼터가 목적이 아니다.</b> 막으려는 것은 무차별 대입의 <b>속도</b>이므로
 * 창 경계에서 몇 건이 새는 것은 문제가 되지 않는다. 그래서 증가와 조회를 두 문장으로
 * 나눴다 — {@code RETURNING} 한 방이 더 정확하지만 그 정확도에 값을 치를 이유가 없고,
 * 두 문장 쪽이 JPA 표준 안에 머문다.</p>
 *
 * <p>엔티티를 만들지 않는다. 이 표는 도메인이 아니라 카운터이고, 영속성 컨텍스트에
 * 올라갈 이유가 없다 — 요청마다 캐시에 쌓이면 그게 더 나쁘다.</p>
 */
@Component
@RequiredArgsConstructor
public class RateLimitCounters {

    /**
     * 같은 창이면 더하고, 창이 바뀌었으면 1 로 되돌린다.
     *
     * <p>UPSERT 표기는 DB 마다 달라 방언별 상수를 두고 {@link DbDialect} 로 고른다.
     * 이 기능은 켜야만 쓰이는 선택 사항이다(기본은 메모리).</p>
     */
    private static final String UPSERT_POSTGRESQL = """
            insert into rate_limit_counters (bucket, window_start, hits, updated_at)
            values (?1, ?2, 1, now())
            on conflict (bucket) do update
               set hits = case when rate_limit_counters.window_start = ?2
                               then rate_limit_counters.hits + 1 else 1 end,
                   window_start = ?2,
                   updated_at = now()
            """;

    /**
     * MariaDB 표기. {@code on duplicate key update} 의 대입은 왼쪽부터 순서대로 평가되므로
     * {@code hits} 가 먼저 <b>이전</b> {@code window_start} 와 비교되고, 그 다음에
     * {@code window_start} 가 새 값으로 바뀐다 — PostgreSQL 판과 같은 의미가 된다.
     */
    private static final String UPSERT_MARIADB = """
            insert into rate_limit_counters (bucket, window_start, hits, updated_at)
            values (?1, ?2, 1, now(6))
            on duplicate key update
               hits = if(window_start = ?2, hits + 1, 1),
               window_start = ?2,
               updated_at = now(6)
            """;

    private static final String SELECT_HITS =
            "select hits from rate_limit_counters where bucket = ?1";

    private static final String PURGE =
            "delete from rate_limit_counters where window_start < ?1";

    private final EntityManager entityManager;
    private final DbDialect dialect;

    /** @return 이 창에서 지금까지 센 횟수 (이번 요청 포함) */
    @Transactional
    public int increment(String bucket, long window) {
        String upsert = dialect == DbDialect.MARIADB ? UPSERT_MARIADB : UPSERT_POSTGRESQL;
        entityManager.createNativeQuery(upsert)
                .setParameter(1, bucket)
                .setParameter(2, window)
                .executeUpdate();
        var hits = entityManager.createNativeQuery(SELECT_HITS)
                .setParameter(1, bucket)
                .getSingleResult();
        return hits instanceof Number n ? n.intValue() : 1;
    }

    /**
     * 지난 창의 행을 치운다.
     *
     * <p>없으면 IP 수만큼 행이 영원히 남는다. 창이 넘어갈 때 한 번만 부르므로
     * 인스턴스당 분당 한 번이다.</p>
     */
    @Transactional
    public int purgeBefore(long window) {
        return entityManager.createNativeQuery(PURGE)
                .setParameter(1, window)
                .executeUpdate();
    }
}
