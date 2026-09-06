package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.UserAttributeDef;
import team.prost.ixauth.repository.UserAttributeDefRepository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * {@code users.attributes}(JSONB) 의 정의와 검증.
 *
 * <p>JSONB 자체는 V1 부터 있었지만 정의도 검증도 없었다. 그래서 앱마다 {@code dept} ·
 * {@code department} · {@code deptCode} 가 섞여 들어가고, 나중에 읽는 쪽에서 어느 것이
 * 맞는지 알아낼 방법이 없다.</p>
 *
 * <p><b>정의가 하나도 없으면 아무 검사도 하지 않는다.</b> 이 기능이 켜졌다는 이유로
 * 지금까지 잘 쓰던 앱이 400 을 받기 시작하면 안 된다.</p>
 */
@Service
@RequiredArgsConstructor
public class UserAttributeService {

    private final UserAttributeDefRepository repository;
    private final IxAuthProperties properties;
    private final AuditService auditService;

    @Transactional(readOnly = true)
    public List<UserAttributeDef> definitions() {
        return repository.findAllByOrderByDisplayOrderAscKeyAsc();
    }

    /**
     * 정의대로 검사하고 <b>정규화한 값</b>을 돌려준다.
     *
     * <p>정규화까지 하는 이유 — 같은 값이 앱에 따라 {@code "3"} 과 {@code 3} 으로 들어오면
     * JSONB 안에서 타입이 갈리고, 그걸 읽는 쪽이 두 경우를 모두 다뤄야 한다. 정의에
     * NUMBER 라고 적어 두었으면 저장되는 것도 숫자여야 한다.</p>
     *
     * @param attributes {@code null} 이면 "손대지 않음" 이라 그대로 {@code null} 을 돌려준다 —
     *                   부분 수정(PATCH)에서 이름만 바꾸는 요청이 속성 검사에 걸리면 안 된다
     */
    @Transactional(readOnly = true)
    public Map<String, Object> validate(Map<String, Object> attributes) {
        if (attributes == null) {
            return null;
        }
        var defs = repository.findAllByOrderByDisplayOrderAscKeyAsc();
        if (defs.isEmpty()) {
            return attributes;
        }

        var violations = new ArrayList<Map<String, String>>();
        var out = new LinkedHashMap<String, Object>();
        for (var def : defs) {
            applyDefinition(def, attributes, out, violations);
        }
        copyUndefined(defs, attributes, out, violations);

        if (!violations.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "사용자 속성이 정의에 맞지 않습니다.", List.copyOf(violations));
        }
        return out;
    }

    /** 정의된 키 하나를 검사해 정규화 결과에 넣는다 */
    private void applyDefinition(UserAttributeDef def, Map<String, Object> given,
                                 Map<String, Object> out, List<Map<String, String>> violations) {
        Object value = given.get(def.getKey());
        if (isEmpty(value)) {
            if (def.isRequired()) {
                violations.add(violation(def.getKey(), def.getLabel() + " 은(는) 필수입니다."));
            }
            // 값이 없으면 키를 만들지 않는다. null 을 넣어 두면 "없음" 과 "비움" 이 섞인다
            return;
        }
        try {
            out.put(def.getKey(), coerce(def, value));
        } catch (IllegalArgumentException e) {
            violations.add(violation(def.getKey(), e.getMessage()));
        }
    }

    /**
     * 정의에 없는 키의 처리 — {@code account.strict-attributes} 가 정한다.
     *
     * <p>기본은 그대로 통과시킨다. 거부를 기본으로 두면, 정의 기능이 없던 시절에 앱이
     * 자유롭게 넣어 둔 키를 가진 사용자를 <b>아무도 수정할 수 없게</b> 된다.</p>
     */
    private void copyUndefined(List<UserAttributeDef> defs, Map<String, Object> given,
                               Map<String, Object> out, List<Map<String, String>> violations) {
        var known = defs.stream().map(UserAttributeDef::getKey).toList();
        boolean strict = properties.getAccount().isStrictAttributes();
        for (var entry : given.entrySet()) {
            if (known.contains(entry.getKey())) {
                continue;
            }
            if (strict) {
                violations.add(violation(entry.getKey(), "정의되지 않은 속성입니다."));
            } else {
                out.put(entry.getKey(), entry.getValue());
            }
        }
    }

    /** 타입에 맞게 바꾼다. 못 바꾸면 그 자리에서 이유를 만들어 던진다 */
    private static Object coerce(UserAttributeDef def, Object value) {
        String text = String.valueOf(value).trim();
        return switch (def.getType()) {
            case STRING -> text;
            case NUMBER -> toNumber(text);
            case BOOLEAN -> toBoolean(text);
            case ENUM -> toEnum(def, text);
            case DATE -> toDate(text);
        };
    }

    private static Object toNumber(String text) {
        try {
            return new BigDecimal(text);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("숫자여야 합니다.");
        }
    }

    private static Object toBoolean(String text) {
        String v = text.toLowerCase(Locale.ROOT);
        if ("true".equals(v) || "false".equals(v)) {
            return Boolean.valueOf(v);
        }
        throw new IllegalArgumentException("true 또는 false 여야 합니다.");
    }

    private static Object toEnum(UserAttributeDef def, String text) {
        var options = def.optionList();
        if (options.isEmpty() || options.contains(text)) {
            // 선택지를 비워 둔 ENUM 은 사실상 STRING 이다. 그 상태로 전부 거부하면
            // 정의를 만들다 만 관리자가 사용자 수정 전체를 막게 된다
            return text;
        }
        throw new IllegalArgumentException("다음 중 하나여야 합니다: " + String.join(", ", options));
    }

    private static Object toDate(String text) {
        try {
            // 저장은 ISO 문자열 그대로. JSONB 에 날짜 타입이 없고, 문자열이면
            // 어떤 앱이 읽어도 해석이 같다
            return LocalDate.parse(text).toString();
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("날짜 형식(YYYY-MM-DD)이어야 합니다.");
        }
    }

    private static boolean isEmpty(Object value) {
        return value == null || (value instanceof String s && s.isBlank());
    }

    private static Map<String, String> violation(String key, String reason) {
        return Map.of("field", "attributes." + key, "reason", reason);
    }

    // ────────────────────── 정의 관리 ──────────────────────

    /** 등록·수정을 하나로 둔다 — 키가 곧 식별자라 나눌 이유가 없다 */
    @Transactional
    public UserAttributeDef save(UserAttributeDef def, Long actorId) {
        if (def.getKey() == null || def.getKey().isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "키는 필수입니다.");
        }
        def.setKey(def.getKey().trim());
        if (def.getLabel() == null || def.getLabel().isBlank()) {
            def.setLabel(def.getKey());
        }
        var saved = repository.save(def);
        auditService.record(AuditService.ATTRIBUTE_DEF_CHANGED, null, actorId, null, null,
                Map.of("key", saved.getKey(), "type", saved.getType().name(),
                        "required", saved.isRequired()));
        return saved;
    }

    /**
     * 정의를 지운다. <b>사용자에게 저장된 값은 건드리지 않는다.</b>
     *
     * <p>정의가 사라졌다고 데이터를 지우면, 정의를 잘못 지운 실수가 곧 데이터 손실이
     * 된다. 정의는 "무엇을 받을 것인가" 이지 "무엇을 보관할 것인가" 가 아니다.</p>
     */
    @Transactional
    public void delete(String key, Long actorId) {
        if (!repository.existsById(key)) {
            throw ApiException.notFound("속성 정의");
        }
        repository.deleteById(key);
        auditService.record(AuditService.ATTRIBUTE_DEF_CHANGED, null, actorId, null, null,
                Map.of("key", key, "deleted", true));
    }
}
