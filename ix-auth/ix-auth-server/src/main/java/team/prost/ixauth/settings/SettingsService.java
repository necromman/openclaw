package team.prost.ixauth.settings;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.Setting;
import team.prost.ixauth.repository.SettingRepository;
import team.prost.ixauth.service.AuditService;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 런타임 설정 — 관리자가 화면에서 바꾸고 <b>재시작 없이</b> 반영된다.
 *
 * <p>동작 방식: 부팅 시 DB 값을 {@link IxAuthProperties} 에 덮어쓰고, 변경 때마다 다시
 * 덮어쓴다. 읽는 쪽(서비스들)은 아무것도 몰라도 된다 — 이미 하던 대로
 * {@code properties.getAccount()...} 를 읽으면 최신값이다.</p>
 *
 * <p>서비스마다 조회 방식을 바꾸지 않은 이유: "어떤 건 yml 을, 어떤 건 DB 를 본다" 는
 * 상태가 생기면 그게 더 위험하다. 한 곳만 최신으로 유지한다.</p>
 *
 * <p><b>다중 인스턴스 주의</b> — 인스턴스 A 에서 바꾸면 B 는 다음 새로고침까지 모른다.
 * 설정 변경은 드물고 잠깐의 불일치가 치명적이지 않아 폴링(1분)으로 맞춘다.
 * 전용 Redis·메시지 버스를 두지 않는 것이 설계 불변식 3 이다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SettingsService {

    private final SettingRepository repository;
    private final SettingDefinitions definitions;
    private final IxAuthProperties properties;
    private final AuditService auditService;
    private final team.prost.ixauth.repository.AuditLogRepository auditLogRepository;

    /** 마지막으로 반영한 DB 상태 — 폴링에서 바뀐 것만 다시 적용하려고 들고 있다 */
    private volatile Map<String, String> applied = Map.of();

    /**
     * yml 기본값 스냅샷 — DB 값을 덮어쓰기 <b>전에</b> 찍는다.
     *
     * <p>이게 없으면 '기본값으로 되돌리기' 가 재기동을 요구하게 된다. yml 값은
     * 한 번 덮어쓰면 메모리 어디에도 남지 않기 때문이다.</p>
     */
    private Map<String, String> defaults = Map.of();

    @PostConstruct
    void loadOnStartup() {
        migrateDeprecated();

        var snapshot = new LinkedHashMap<String, String>();
        definitions.all().forEach(b -> snapshot.put(b.key(), b.reader().apply(properties)));
        defaults = Map.copyOf(snapshot);

        try {
            reload();
        } catch (Exception e) {
            // 설정을 못 읽었다고 부팅을 막지 않는다 — yml 기본값으로 뜨는 편이 낫다
            log.warn("런타임 설정을 불러오지 못했습니다. yml 기본값으로 시작합니다 ({})",
                    e.getMessage());
        }
    }

    /**
     * 옛 {@code signup-enabled} 를 새 {@code signup-mode} 로 옮긴다.
     *
     * <p>설정 이름이 바뀌었다고 이미 배포된 곳의 동작이 조용히 달라지면 안 된다.
     * {@code true} 였다면 '즉시 가입' 이었으므로 그대로 유지한다.</p>
     */
    @SuppressWarnings("deprecation")
    private void migrateDeprecated() {
        Boolean legacy = properties.getAccount().getSignupEnabled();
        if (legacy == null) {
            return;
        }
        var mode = legacy ? IxAuthProperties.SignupMode.OPEN
                : IxAuthProperties.SignupMode.CLOSED;
        properties.getAccount().setSignupMode(mode);
        log.warn("ixauth.account.signup-enabled 는 더 이상 쓰이지 않습니다. "
                + "signup-mode={} 로 해석했습니다. 설정 파일을 갱신하세요.", mode);
    }

    /** DB 값을 설정 객체에 반영한다. 부팅 시와 변경 후에 부른다 */
    @Transactional(readOnly = true)
    public void reload() {
        var rows = new LinkedHashMap<String, String>();
        repository.findAll().forEach(s -> rows.put(s.getKey(), s.getValue()));

        for (var binding : definitions.all()) {
            String stored = rows.get(binding.key());
            if (stored == null) {
                continue;      // 저장된 값이 없으면 yml 기본값 그대로
            }
            try {
                binding.applier().accept(properties, stored);
            } catch (Exception e) {
                // 값 하나가 잘못됐다고 나머지까지 못 쓰게 만들지 않는다
                log.warn("설정 값을 해석하지 못했습니다 — key={} value={} ({})",
                        binding.key(), stored, e.getMessage());
            }
        }
        applied = Map.copyOf(rows);
    }

    /**
     * 다른 인스턴스에서 바뀐 설정을 따라잡는다.
     *
     * <p>인스턴스가 하나면 아무 일도 하지 않는다(값이 같으므로). 여럿이면 최대 1분 뒤에
     * 맞춰진다 — 설정 변경은 드물고, 그 사이의 불일치가 치명적인 설정은 두지 않는다.</p>
     */
    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    public void pollForExternalChanges() {
        try {
            var rows = new LinkedHashMap<String, String>();
            repository.findAll().forEach(s -> rows.put(s.getKey(), s.getValue()));
            if (!rows.equals(applied)) {
                log.info("다른 인스턴스의 설정 변경을 반영합니다");
                reload();
            }
        } catch (Exception e) {
            log.debug("설정 폴링 실패 — {}", e.getMessage());
        }
    }

    // ────────────────────── 조회 ──────────────────────

    /** 화면이 그릴 전체 목록 — 정의 + 현재 값 */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> describeAll() {
        var stored = new LinkedHashMap<String, Setting>();
        repository.findAll().forEach(s -> stored.put(s.getKey(), s));

        return definitions.all().stream().<Map<String, Object>>map(b -> {
            var d = b.definition();
            var m = new LinkedHashMap<String, Object>();
            m.put("key", d.key());
            m.put("type", d.type().name());
            m.put("group", d.group());
            m.put("label", d.label());
            m.put("help", d.help());
            m.put("options", d.options().stream()
                    .map(o -> Map.of("value", o.value(), "label", o.label())).toList());
            m.put("value", b.reader().apply(properties));
            // 관리자가 바꾼 값인지, yml 기본값 그대로인지 구분해 보여 준다
            m.put("overridden", stored.containsKey(d.key()));
            var row = stored.get(d.key());
            m.put("updatedAt", row == null ? null : row.getUpdatedAt());
            m.put("defaultValue", defaults.get(d.key()));
            m.put("requiresRestart", d.requiresRestart());
            m.put("warning", d.warning());
            // 다른 설정 값에 따라 화면에서 숨긴다 (SMTP 를 안 골랐는데 호스트 칸이
            // 떠 있으면 "적었는데 왜 안 되지" 가 된다)
            m.put("dependsOnKey", d.dependsOnKey());
            m.put("dependsOnValue", d.dependsOnValue());
            return m;
        }).toList();
    }

    public List<String> groups() {
        return definitions.groups();
    }

    // ────────────────────── 변경 ──────────────────────

    /**
     * 설정을 바꾼다.
     *
     * <p>정의에 없는 키는 거부한다 — 아무 키나 저장하게 두면 오타가 조용히 묻히고,
     * 나중에 "설정했는데 안 먹는다" 로 나타난다.</p>
     */
    @Transactional
    public void update(String key, String value, Long actorId, String ip, String userAgent) {
        var binding = definitions.find(key);
        if (binding == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "알 수 없는 설정입니다: " + key);
        }

        String before = binding.reader().apply(properties);

        // 저장 전에 적용해 본다. 형식이 틀리면 여기서 걸려 DB 에 쓰레기가 남지 않는다
        try {
            binding.applier().accept(properties, value);
        } catch (Exception e) {
            binding.applier().accept(properties, before);   // 되돌린다
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "값이 올바르지 않습니다: " + e.getMessage());
        }

        var row = repository.findById(key).orElseGet(() -> new Setting(key, value, actorId));
        row.setValue(value);
        row.setUpdatedBy(actorId);
        row.setUpdatedAt(Instant.now());
        repository.save(row);

        // 무엇이 무엇으로 바뀌었는지 남긴다. 값만 남기면 되돌릴 때 근거가 없다
        auditService.record("SETTING_CHANGED", null, actorId, ip, userAgent,
                Map.of("key", key, "before", before, "after", value));
        log.info("설정 변경 — {} : {} → {} (actor={})", key, before, value, actorId);

        reload();
    }

    /** 기본값(yml)으로 되돌린다 — DB 행을 지우고 부팅 시 찍어 둔 스냅샷을 다시 적용한다 */
    @Transactional
    public void reset(String key, Long actorId, String ip, String userAgent) {
        var binding = definitions.find(key);
        if (binding == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "알 수 없는 설정입니다: " + key);
        }
        String before = binding.reader().apply(properties);
        repository.deleteById(key);

        String fallback = defaults.get(key);
        if (fallback != null) {
            binding.applier().accept(properties, fallback);
        }
        auditService.record("SETTING_RESET", null, actorId, ip, userAgent,
                Map.of("key", key, "before", before, "after", fallback == null ? "" : fallback));
        log.info("설정 초기화 — {} : {} → {} (actor={})", key, before, fallback, actorId);
        reload();
    }

    /** 화면이 '기본값과 다름' 을 표시하는 데 쓴다 */
    public String defaultOf(String key) {
        return defaults.get(key);
    }

    /**
     * 이 설정이 언제 누구에 의해 무엇에서 무엇으로 바뀌었는가 (G25).
     *
     * <p><b>표를 새로 만들지 않았다.</b> 설정 변경은 이미 감사 로그에 남아 있고
     * ({@code SETTING_CHANGED}·{@code SETTING_RESET}), 같은 사실을 두 곳에 두면
     * 언젠가 둘이 어긋난다. 여기서는 그 로그를 키로 좁혀 보여 줄 뿐이다.</p>
     *
     * <p>감사 로그가 보존 기간에 걸려 지워졌으면 이력도 그만큼만 남는다 — 설정 이력을
     * 따로 영구 보관할 이유가 그 정책보다 크지 않다.</p>
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> history(String key, int max) {
        if (definitions.find(key) == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "알 수 없는 설정입니다: " + key);
        }
        int capped = Math.min(Math.max(max, 1), 200);
        return auditLogRepository.findSettingHistory(key, capped).stream()
                .<Map<String, Object>>map(entry -> {
                    var m = new LinkedHashMap<String, Object>();
                    m.put("eventType", entry.getEventType());
                    m.put("actorId", entry.getActorId());
                    m.put("ip", entry.getIp());
                    m.put("before", String.valueOf(entry.getDetail().get("before")));
                    m.put("after", String.valueOf(entry.getDetail().get("after")));
                    m.put("changedAt", entry.getCreatedAt());
                    return m;
                }).toList();
    }
}
