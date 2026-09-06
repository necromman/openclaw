package team.prost.ixauth.mail;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.MailTemplate;
import team.prost.ixauth.mail.MailMessage.Kind;
import team.prost.ixauth.repository.MailTemplateRepository;
import team.prost.ixauth.service.AuditService;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 메일 템플릿 해석 — 관리자가 고쳐 둔 것이 있으면 그것, 없으면 코드 기본값(G16 · G17).
 *
 * <p>설정({@code SettingsService})과 같은 모양이다 — <b>행이 없으면 코드 기본값</b>.
 * 그래야 이 기능이 생겼다는 이유로 이미 운영 중인 설치의 메일 문구가 달라지지 않는다.</p>
 *
 * <p>언어를 고르는 순서는 <b>좁은 것부터</b>다: 요청 언어의 DB → 기본 언어의 DB →
 * 요청 언어의 코드 기본 → 기본 언어의 코드 기본. 메일이 <b>안 나가는 것보다</b> 다른
 * 언어로라도 나가는 편이 낫다 — 링크를 받지 못하면 사용자는 계정을 되찾을 수 없다.</p>
 */
@Service
@RequiredArgsConstructor
public class MailTemplateService {

    private final MailTemplateRepository repository;
    private final IxAuthProperties properties;
    private final AuditService auditService;

    /** 실제 발송이 쓰는 해석 결과 */
    @Transactional(readOnly = true)
    public MailTemplates.Template resolve(Kind kind, String locale) {
        String fallback = defaultLocale();
        var stored = repository.findByKindAndLocale(kind.name(), locale);
        if (stored.isEmpty() && !fallback.equals(locale)) {
            stored = repository.findByKindAndLocale(kind.name(), fallback);
        }
        return stored
                .map(t -> new MailTemplates.Template(t.getSubject(), t.getBody()))
                .orElseGet(() -> MailTemplates.defaultOf(kind, locale, fallback));
    }

    /** 관리 화면 목록 — 코드 기본값과 관리자가 고친 값을 함께 보여 준다 */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> describeAll() {
        var stored = new LinkedHashMap<String, MailTemplate>();
        repository.findAllByOrderByKindAscLocaleAsc()
                .forEach(t -> stored.put(t.getKind() + "|" + t.getLocale(), t));

        var out = new ArrayList<Map<String, Object>>();
        for (Kind kind : Kind.values()) {
            for (String locale : MailTemplates.BUILT_IN_LOCALES) {
                out.add(describe(kind, locale, stored.get(kind.name() + "|" + locale)));
            }
        }
        // 관리자가 직접 넣은 그 밖의 언어도 보여 준다 — 안 보이면 지울 수도 없다
        stored.values().stream()
                .filter(t -> !MailTemplates.BUILT_IN_LOCALES.contains(t.getLocale()))
                .forEach(t -> out.add(describe(kindOf(t.getKind()), t.getLocale(), t)));
        return out;
    }

    private Map<String, Object> describe(Kind kind, String locale, MailTemplate row) {
        var builtIn = MailTemplates.builtIn(kind, locale);
        var m = new LinkedHashMap<String, Object>();
        m.put("kind", kind.name());
        m.put("locale", locale);
        m.put("subject", row != null ? row.getSubject()
                : builtIn == null ? "" : builtIn.subject());
        m.put("body", row != null ? row.getBody() : builtIn == null ? "" : builtIn.body());
        // 코드 기본값 그대로인지, 관리자가 고쳤는지 — 설정 화면의 '변경됨' 과 같은 표시다
        m.put("overridden", row != null);
        m.put("updatedAt", row == null ? null : row.getUpdatedAt());
        m.put("updatedBy", row == null ? null : row.getUpdatedBy());
        m.put("defaultSubject", builtIn == null ? null : builtIn.subject());
        m.put("defaultBody", builtIn == null ? null : builtIn.body());
        return m;
    }

    /** 편집 — 덮어쓰기다. 없으면 새로 만든다 */
    @Transactional
    public void save(String kindName, String rawLocale, String subject, String body,
                     Long actorId) {
        var kind = kindOf(kindName);
        String locale = requireLocale(rawLocale);
        if (subject == null || subject.isBlank() || body == null || body.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "제목과 본문은 비울 수 없습니다.");
        }
        var row = repository.findByKindAndLocale(kind.name(), locale)
                .orElseGet(() -> new MailTemplate(kind.name(), locale, subject, body, actorId));
        row.setSubject(subject.trim());
        row.setBody(body);
        row.setUpdatedBy(actorId);
        row.setUpdatedAt(Instant.now());
        repository.save(row);

        // 본문은 남기지 않는다 — 감사 로그가 메일 본문 저장소가 되면 안 된다.
        // 무엇이 언제 누구에 의해 바뀌었는지만 남기고, 내용은 이 표에서 본다
        auditService.record(AuditService.MAIL_TEMPLATE_CHANGED, null, actorId, null, null,
                Map.of("kind", kind.name(), "locale", locale));
    }

    /** 초기화 — 행을 지우면 코드 기본값으로 돌아간다 */
    @Transactional
    public boolean reset(String kindName, String rawLocale, Long actorId) {
        var kind = kindOf(kindName);
        String locale = requireLocale(rawLocale);
        var row = repository.findByKindAndLocale(kind.name(), locale);
        row.ifPresent(repository::delete);
        if (row.isPresent()) {
            auditService.record(AuditService.MAIL_TEMPLATE_RESET, null, actorId, null, null,
                    Map.of("kind", kind.name(), "locale", locale));
        }
        return row.isPresent();
    }

    /**
     * 미리보기 — 저장하기 <b>전에</b> 실제 치환 결과를 본다.
     *
     * <p>자리표시자를 오타 내면({@code {nmae}}) 그대로 본문에 남고, 그 사실은 사용자가
     * 받은 뒤에야 드러난다. 그 전에 눈으로 확인할 수 있게 한다.</p>
     *
     * <p>링크는 <b>가짜다.</b> 미리보기가 진짜 토큰을 만들면 관리 화면을 여는 것만으로
     * 유효한 재설정 링크가 생긴다.</p>
     */
    public Map<String, Object> preview(String kindName, String rawLocale,
                                       String subject, String body) {
        var kind = kindOf(kindName);
        String locale = requireLocale(rawLocale);
        var template = (subject == null || body == null)
                ? resolve(kind, locale)
                : new MailTemplates.Template(subject, body);

        var vars = sampleVars();
        var m = new LinkedHashMap<String, Object>();
        m.put("kind", kind.name());
        m.put("locale", locale);
        m.put("subject", MailTemplates.fill(template.subject(), vars));
        m.put("body", MailTemplates.fill(template.body(), vars));
        return m;
    }

    private Map<String, String> sampleVars() {
        var mail = properties.getMail();
        String base = mail.getAppBaseUrl().isBlank() ? "https://app.example.com"
                : mail.getAppBaseUrl();
        var v = new LinkedHashMap<String, String>();
        v.put("name", "홍길동");
        v.put("productName", mail.getProductName());
        v.put("expiresIn", "30분");
        v.put("link", base + mail.getResetPath() + "?token=(미리보기라 실제 토큰이 아니다)");
        v.put("inviter", "김철수 님이 회원님을 ");
        v.put("inviterName", "김철수");
        v.put("at", "2026-08-08 21:30 KST");
        v.put("ip", "203.0.113.7");
        v.put("device", "Chrome · Windows");
        return v;
    }

    private String defaultLocale() {
        return MailTemplates.normalizeLocale(properties.getMail().getDefaultLocale(),
                MailTemplates.KO);
    }

    private String requireLocale(String raw) {
        String v = MailTemplates.normalizeLocale(raw, "");
        if (v.isBlank() || v.length() > 10) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "언어 코드가 올바르지 않습니다 (예: ko, en).");
        }
        return v;
    }

    private Kind kindOf(String raw) {
        try {
            return Kind.valueOf(raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "알 수 없는 메일 용도입니다: " + raw);
        }
    }
}
