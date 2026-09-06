package team.prost.ixauth.api.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.domain.Term;
import team.prost.ixauth.service.TermsService;

import java.time.Instant;
import java.util.List;

/**
 * 약관 관리 — 등록 · 수정 · 게시 · 동의 이력 조회.
 *
 * <p><b>동의 이력을 지우거나 고치는 엔드포인트는 없다.</b> 감사 로그와 같은 이유다 —
 * 지울 수 있는 경로가 하나라도 있으면 그 순간 증빙이 아니게 된다.</p>
 */
@RestController
@RequestMapping("/admin/terms")
@RequiredArgsConstructor
public class TermsAdminController {

    private final TermsService termsService;
    private final AdminGuard guard;

    /**
     * @param version 무시된다 — 서버가 매긴다. 응답에서 확인한다
     */
    public record CreateRequest(@NotBlank String code, @NotBlank String title,
                                String body, String bodyUrl, Boolean required,
                                Integer displayOrder, Integer version) {
    }

    public record UpdateRequest(String title, String body, String bodyUrl,
                                Boolean required, Integer displayOrder) {
    }

    /**
     * @param agreementCount 이 버전에 남은 동의 이력 수. 0 이 아니면 삭제할 수 없다 —
     *                       화면이 그 사실을 미리 알려 줄 수 있게 함께 준다
     */
    public record TermView(Long id, String code, int version, String title, String body,
                           String bodyUrl, boolean required, int displayOrder,
                           Instant publishedAt, long agreementCount, Instant createdAt) {
    }

    public record AgreementView(Long id, Long userId, String code, int version,
                                boolean agreed, Instant agreedAt, String ip) {
    }

    @GetMapping
    public ApiResponse<List<TermView>> list() {
        guard.require(AdminGuard.USERS_READ);
        return ApiResponse.ok(termsService.all().stream().map(this::toView).toList());
    }

    @GetMapping("/{id}")
    public ApiResponse<TermView> get(@PathVariable Long id) {
        guard.require(AdminGuard.USERS_READ);
        return ApiResponse.ok(toView(termsService.get(id)));
    }

    /**
     * 새 약관 또는 새 버전. <b>언제나 초안으로 만들어진다</b> — 만드는 즉시 사용자에게
     * 보이면, 문안을 다듬는 동안 반쯤 쓴 약관이 가입 화면에 뜬다.
     */
    @PostMapping
    public ApiResponse<TermView> create(@Valid @RequestBody CreateRequest req) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        var draft = new Term(req.code().trim(), 0, req.title().trim());
        draft.setBody(blankToNull(req.body()));
        draft.setBodyUrl(blankToNull(req.bodyUrl()));
        draft.setRequired(req.required() == null || req.required());
        draft.setDisplayOrder(req.displayOrder() == null ? 0 : req.displayOrder());
        return ApiResponse.ok(toView(termsService.create(draft, actor.userId())));
    }

    /**
     * 표준 약관 문안을 초안으로 불러온다 — 이용약관 · 개인정보 수집·이용 · 만 14세 이상 ·
     * 광고성 정보 수신.
     *
     * <p>빈 화면에서 약관을 처음부터 쓰게 하면 필수/선택 구분이나 개인정보 항목이
     * 빠진 채로 서비스가 열리기 쉽다. 고쳐 쓸 출발점을 준다.</p>
     *
     * <p><b>이미 있는 코드는 건너뛴다.</b> 여러 번 눌러도 결과가 같으므로, 관리자가
     * 자기가 쓴 약관을 덮어쓸 걱정 없이 눌러 볼 수 있다. 게시는 따로 눌러야 한다.</p>
     *
     * @return 이번에 만들어진 것만
     */
    @PostMapping("/templates")
    public ApiResponse<List<TermView>> seedTemplates() {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        return ApiResponse.ok(termsService.seedTemplates(actor.userId()).stream()
                .map(this::toView).toList());
    }

    /**
     * 초안 수정. <b>게시된 약관은 표시 순서만 바뀐다</b> — 내용을 고치면 이미 동의한
     * 사람의 이력이 가리키는 대상이 달라진다. 내용 변경은 새 버전으로 낸다.
     */
    @PatchMapping("/{id}")
    public ApiResponse<TermView> update(@PathVariable Long id,
                                        @RequestBody UpdateRequest req) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        var current = termsService.get(id);
        var patch = new Term();
        patch.setTitle(req.title());
        patch.setBody(req.body());
        patch.setBodyUrl(req.bodyUrl());
        patch.setRequired(req.required() == null ? current.isRequired() : req.required());
        patch.setDisplayOrder(req.displayOrder() == null
                ? current.getDisplayOrder() : req.displayOrder());
        return ApiResponse.ok(toView(termsService.update(id, patch, actor.userId())));
    }

    /** 게시 — 되돌리는 기능은 없다. 이미 본 사람과 동의한 사람을 없던 일로 할 수 없다 */
    @PostMapping("/{id}/publish")
    public ApiResponse<TermView> publish(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        return ApiResponse.ok(toView(termsService.publish(id, actor.userId())));
    }

    /** 동의 이력이 한 건이라도 있으면 409 — 오타 난 초안을 치우는 용도다 */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        termsService.delete(id, actor.userId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/agreements")
    public ApiResponse<ApiResponse.PageData<AgreementView>> agreements(
            @PathVariable Long id,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        guard.require(AdminGuard.USERS_READ);
        int capped = Math.min(size, 100);
        var result = termsService.agreementsOf(id, PageRequest.of(page, capped));
        var items = result.getContent().stream()
                .map(a -> new AgreementView(a.getId(), a.getUserId(), a.getCode(),
                        a.getVersion(), a.isAgreed(), a.getAgreedAt(), a.getIp()))
                .toList();
        return ApiResponse.ok(
                new ApiResponse.PageData<>(items, page, capped, result.getTotalElements()));
    }

    private TermView toView(Term t) {
        return new TermView(t.getId(), t.getCode(), t.getVersion(), t.getTitle(),
                t.getBody(), t.getBodyUrl(), t.isRequired(), t.getDisplayOrder(),
                t.getPublishedAt(), termsService.agreementCount(t.getId()), t.getCreatedAt());
    }

    private static String blankToNull(String v) {
        return (v == null || v.isBlank()) ? null : v.trim();
    }
}
