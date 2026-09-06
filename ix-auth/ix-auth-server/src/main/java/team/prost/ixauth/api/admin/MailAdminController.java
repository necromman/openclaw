package team.prost.ixauth.api.admin;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.mail.MailDeliveryService;
import team.prost.ixauth.mail.MailTemplateService;
import team.prost.ixauth.repository.MailDeliveryRepository;
import team.prost.ixauth.service.AuditService;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 메일 운영 — 발송 이력·재시도(G21) · 템플릿 편집·미리보기(G16 · G17).
 *
 * <p>메일은 이 제품에서 <b>사용자에게 닿는 유일한 통로</b>다. 안 갔다는 사실을 운영자가
 * 알 수 없으면 "비밀번호 찾기가 안 된다" 는 문의가 원인 없이 쌓인다.</p>
 */
@RestController
@RequestMapping("/admin")
@RequiredArgsConstructor
public class MailAdminController {

    private final MailDeliveryRepository deliveryRepository;
    private final MailDeliveryService deliveryService;
    private final MailTemplateService templateService;
    private final AuditService auditService;
    private final AdminGuard guard;

    // ────────────────────── 발송 이력 ──────────────────────

    /**
     * 최근 발송 목록.
     *
     * <p><b>본문과 링크는 없다.</b> 이력에 저장하지 않기 때문이다 — 재설정 링크가
     * 남으면 그것이 곧 계정 탈취 경로다. 여기서 보이는 것은 누구에게 · 무슨 용도로 ·
     * 어떻게 됐는지 뿐이다.</p>
     */
    @GetMapping("/mail-deliveries")
    public ApiResponse<ApiResponse.PageData<Map<String, Object>>> deliveries(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String email,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        guard.require(AdminGuard.USERS_READ);
        int capped = Math.min(size, 100);
        var retryable = deliveryService.retryableIds();

        var result = deliveryRepository.search(
                status == null ? "" : status.trim().toUpperCase(java.util.Locale.ROOT),
                kind == null ? "" : kind.trim().toUpperCase(java.util.Locale.ROOT),
                email == null ? "" : email.trim(),
                PageRequest.of(page, capped));

        var items = result.getContent().stream()
                .<Map<String, Object>>map(d -> {
                    var m = new LinkedHashMap<String, Object>();
                    m.put("id", d.getId());
                    m.put("to", d.getToEmail());
                    m.put("kind", d.getKind());
                    m.put("subject", d.getSubject());
                    m.put("locale", d.getLocale());
                    m.put("status", d.getStatus().name());
                    m.put("attempts", d.getAttempts());
                    m.put("lastError", d.getLastError());
                    m.put("createdAt", d.getCreatedAt());
                    m.put("sentAt", d.getSentAt());
                    // 메시지를 아직 들고 있는가 — 버튼을 그릴지 여기서 정한다
                    m.put("retryable", retryable.contains(d.getId()));
                    return m;
                }).toList();
        return ApiResponse.ok(new ApiResponse.PageData<>(items, page, capped,
                result.getTotalElements()));
    }

    /**
     * 실패한 메일을 지금 다시 보낸다.
     *
     * <p>메시지를 더 이상 들고 있지 않으면 {@code CONFLICT} 다. 본문·링크를 저장하지
     * 않으므로 되살릴 방법이 없고, <b>없는 것을 있는 척하지 않는다</b> — 그 경우
     * 운영자는 해당 기능(초대·재설정)을 다시 실행해야 한다.</p>
     */
    @PostMapping("/mail-deliveries/{id}/retry")
    public ApiResponse<Map<String, Object>> retry(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        if (!deliveryService.retryNow(id)) {
            throw new ApiException(ErrorCode.CONFLICT,
                    "이 메일은 다시 보낼 수 없습니다. 본문과 링크를 저장하지 않기 때문입니다 "
                            + "— 해당 기능(초대·재설정 등)을 다시 실행하세요.");
        }
        auditService.record(AuditService.MAIL_DELIVERY_RETRIED, null, actor.userId(),
                null, null, Map.of("deliveryId", id));
        return ApiResponse.ok(Map.of("id", id, "retried", true));
    }

    // ────────────────────── 템플릿 ──────────────────────

    public record TemplateRequest(String subject, String body) {
    }

    public record PreviewRequest(String kind, String locale, String subject, String body) {
    }

    /** 용도 × 언어 전체 — 코드 기본값과 관리자가 고친 값을 함께 준다 */
    @GetMapping("/mail-templates")
    public ApiResponse<List<Map<String, Object>>> templates() {
        guard.require(AdminGuard.USERS_READ);
        return ApiResponse.ok(templateService.describeAll());
    }

    @PutMapping("/mail-templates/{kind}/{locale}")
    public ApiResponse<Map<String, Object>> saveTemplate(@PathVariable String kind,
                                                         @PathVariable String locale,
                                                         @RequestBody TemplateRequest req) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        templateService.save(kind, locale, req.subject(), req.body(), actor.userId());
        return ApiResponse.ok(Map.of("kind", kind, "locale", locale, "saved", true));
    }

    /** 초기화 — 행을 지우면 코드 기본값으로 돌아간다 */
    @DeleteMapping("/mail-templates/{kind}/{locale}")
    public ResponseEntity<Void> resetTemplate(@PathVariable String kind,
                                              @PathVariable String locale) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        templateService.reset(kind, locale, actor.userId());
        return ResponseEntity.noContent().build();
    }

    /**
     * 미리보기 — 저장하기 전에 치환 결과를 본다.
     *
     * <p>링크는 가짜다. 미리보기가 진짜 토큰을 만들면 관리 화면을 여는 것만으로
     * 유효한 재설정 링크가 생긴다.</p>
     */
    @PostMapping("/mail-templates/preview")
    public ApiResponse<Map<String, Object>> preview(@RequestBody PreviewRequest req) {
        guard.require(AdminGuard.USERS_READ);
        return ApiResponse.ok(templateService.preview(req.kind(), req.locale(),
                req.subject(), req.body()));
    }
}
