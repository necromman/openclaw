package team.prost.ixauth.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.domain.UserStatus;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    /** 이메일은 대소문자를 구분하지 않는다 (uq_users_email 이 lower(email) 유일 인덱스) */
    @Query("select u from User u where lower(u.email) = lower(:email)")
    Optional<User> findByEmailIgnoreCase(@Param("email") String email);

    @Query("select count(u) > 0 from User u where lower(u.email) = lower(:email)")
    boolean existsByEmailIgnoreCase(@Param("email") String email);

    /** 승인 대기 목록 — 오래 기다린 사람이 위로 */
    List<User> findByStatusOrderByCreatedAtAsc(UserStatus status);

    /**
     * 탈퇴 유예가 끝난 계정 — 야간 배치가 비활성으로 바꿀 대상.
     *
     * <p>이미 {@code DISABLED} 인 행은 뺀다. 그 계정은 처리가 끝났거나 관리자가 따로
     * 닫은 것이고, 다시 훑으면 감사 로그에 같은 사건이 매일 쌓인다.</p>
     */
    @Query("select u from User u where u.deletionRequestedAt is not null "
            + "and u.deletionRequestedAt < :before and u.status <> :excluded")
    List<User> findDeletionDue(@Param("before") java.time.Instant before,
                               @Param("excluded") UserStatus excluded);

    /** 이메일 변경 시 — 자기 자신은 충돌로 보지 않는다 */
    @Query("select count(u) > 0 from User u where lower(u.email) = lower(:email) and u.id <> :id")
    boolean existsByEmailIgnoreCaseAndIdNot(@Param("email") String email, @Param("id") Long id);

    /**
     * 직접 부여된 역할 코드.
     *
     * <p>유효 역할 = 이것 ∪ {@link #findGroupRoleCodes}. 합집합은 서비스에서 만든다 —
     * JPQL {@code union} 은 Hibernate 확장이라 이식성이 떨어진다.</p>
     */
    @Query("select distinct r.code from User u join u.roles r where u.id = :userId")
    List<String> findDirectRoleCodes(@Param("userId") Long userId);

    /** 소속 그룹을 경유해 얻는 역할 코드 */
    @Query("select distinct gr.code from User u join u.groups g join g.roles gr where u.id = :userId")
    List<String> findGroupRoleCodes(@Param("userId") Long userId);

    @Query("select distinct g.code from User u join u.groups g where u.id = :userId")
    List<String> findGroupCodes(@Param("userId") Long userId);

    // ── L2 판정용 주체 ID (resource_grants 의 subject_id 와 대조) ──

    @Query("select distinct g.id from User u join u.groups g where u.id = :userId")
    List<Long> findGroupIds(@Param("userId") Long userId);

    @Query("select distinct r.id from User u join u.roles r where u.id = :userId")
    List<Long> findDirectRoleIds(@Param("userId") Long userId);

    @Query("select distinct gr.id from User u join u.groups g join g.roles gr where u.id = :userId")
    List<Long> findGroupRoleIds(@Param("userId") Long userId);

    /**
     * 사용자 검색.
     *
     * <p>⚠ 파라미터에 null 을 바인딩하지 않는다. PostgreSQL 은 null 파라미터의 타입을
     * 추론하지 못해 {@code lower(bytea) does not exist} 로 터진다 (2026-08-08 실측).
     * 빈 문자열과 전체 상태 집합을 넘겨 조건을 무력화한다.</p>
     *
     * <p>역할 조건은 <b>유효 역할</b> 기준이다 — 직접 부여분(user_roles)과 그룹 경유분
     * (user_groups → group_roles)을 모두 본다. 응답의 {@code roles} 가 그 합집합이므로
     * (AuthzService#effectiveRoleCodes) 필터도 같은 기준이어야 한다. 다르면 화면에
     * "TEACHER" 라고 적힌 사람이 {@code ?role=TEACHER} 에 안 잡히고, 그 목록은 못 믿는다.</p>
     *
     * <p>두 개의 {@code exists} 로 나눈 이유 — 조인으로 붙이면 역할이 여럿인 사용자가
     * 결과에 여러 번 나오고, {@code distinct} 로 지우면 {@code count} 쿼리와 페이지
     * 계산이 어긋난다.</p>
     *
     * @param q        검색어. 없으면 빈 문자열
     * @param statuses 대상 상태. 필터가 없으면 전체 enum 값
     * @param role     역할 코드. 필터가 없으면 빈 문자열
     */
    @Query("""
            select u from User u
             where (:q = '' or lower(u.email) like lower(concat('%', :q, '%'))
                            or lower(u.name)  like lower(concat('%', :q, '%')))
               and u.status in :statuses
               and (:role = ''
                    or exists (select 1 from User du join du.roles dr
                                where du.id = u.id and dr.code = :role)
                    or exists (select 1 from User gu join gu.groups g join g.roles gr
                                where gu.id = u.id and gr.code = :role))
            """)
    Page<User> search(@Param("q") String q,
                      @Param("statuses") Collection<UserStatus> statuses,
                      @Param("role") String role,
                      Pageable pageable);
}
