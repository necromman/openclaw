package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.Term;
import team.prost.ixauth.domain.TermAgreement;
import team.prost.ixauth.repository.TermAgreementRepository;
import team.prost.ixauth.repository.TermRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 약관 — 조회 · 동의 · 재동의 판정 · 관리.
 *
 * <p>이 클래스를 관통하는 두 가지:</p>
 * <ul>
 *   <li><b>동의 이력은 지우지도 고치지도 않는다.</b> 철회는 {@code agreed = false} 인
 *       새 행이다. 덮어쓰면 "언제부터 언제까지 동의 상태였는가" 가 사라지는데,
 *       증빙에서 필요한 것이 바로 그 구간이다</li>
 *   <li><b>재동의는 로그인을 막지 않는다.</b> 막으면 새 버전을 게시하는 순간 전원이
 *       못 들어온다. 신호({@code termsAgreementRequired})를 주고 앱이 동의 화면으로
 *       보내게 한다 — 2단계 인증의 {@code mfaSetupRequired} 와 같은 방식이다</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TermsService {

    private final TermRepository termRepository;
    private final TermAgreementRepository agreementRepository;
    private final IxAuthProperties properties;
    private final AuditService auditService;

    // ────────────────────── 사용자 쪽 ──────────────────────

    /**
     * 지금 사용자에게 보여야 할 약관 — 코드마다 최신 게시본 하나씩.
     *
     * <p>기능이 꺼져 있으면 빈 목록이다. 등록해 둔 약관을 <b>지우지는 않는다</b> —
     * 잠시 껐다고 법적 증빙이 사라지면 안 된다.</p>
     */
    @Transactional(readOnly = true)
    public List<Term> currentPublished() {
        if (!properties.getTerms().isEnabled()) {
            return List.of();
        }
        return termRepository.findCurrentPublished();
    }

    /**
     * 이 사용자가 아직 동의하지 않은 <b>필수</b> 약관 코드.
     *
     * <p>로그인 응답에 실린다. 비어 있으면 앱은 아무것도 하지 않아도 된다.</p>
     *
     * <p>{@code reagreement-required} 가 꺼져 있으면 <b>버전을 보지 않는다</b> — 한 번
     * 동의했으면 개정돼도 그대로 둔다는 뜻이고, 그 선택의 대가(개정된 내용에 동의받은
     * 적이 없게 된다)는 설정 화면의 경고에 적어 두었다.</p>
     */
    @Transactional(readOnly = true)
    public List<String> pendingRequiredCodes(Long userId) {
        if (!properties.getTerms().isEnabled() || userId == null) {
            return List.of();
        }
        var published = termRepository.findCurrentPublished();
        if (published.isEmpty()) {
            return List.of();
        }
        var latest = latestByCode(userId);
        boolean reagreement = properties.getTerms().isReagreementRequired();

        var pending = new ArrayList<String>();
        for (Term term : published) {
            if (!term.isRequired()) {
                continue;      // 선택 약관은 답하지 않아도 그만이다
            }
            var answer = latest.get(term.getCode());
            boolean satisfied = answer != null && answer.isAgreed()
                    && (!reagreement || answer.getVersion() >= term.getVersion());
            if (!satisfied) {
                pending.add(term.getCode());
            }
        }
        return List.copyOf(pending);
    }

    /**
     * 가입 요청에 필수 동의가 다 들어 있는지 본다.
     *
     * <p>계정을 만들기 <b>전에</b> 부른다. 만든 뒤에 막으면 동의하지 않은 계정이 남고,
     * 같은 주소로 다시 가입할 수도 없게 된다.</p>
     */
    @Transactional(readOnly = true)
    public void assertRequiredAgreed(Map<String, Boolean> agreements) {
        var terms = properties.getTerms();
        if (!terms.isEnabled() || !terms.isRequireOnSignup()) {
            return;
        }
        var given = agreements == null ? Map.<String, Boolean>of() : agreements;
        var missing = termRepository.findCurrentPublished().stream()
                .filter(Term::isRequired)
                .filter(t -> !Boolean.TRUE.equals(given.get(t.getCode())))
                .map(Term::getCode)
                .toList();
        if (missing.isEmpty()) {
            return;
        }
        // 어떤 것이 빠졌는지 알려 준다 — "약관에 동의하세요" 만으로는 앱이 어느
        // 체크박스를 짚어 줘야 할지 알 수 없다
        var details = missing.stream()
                .map(code -> Map.of("field", "agreements." + code,
                        "reason", "필수 약관입니다."))
                .toList();
        throw new ApiException(ErrorCode.AUTH_TERMS_REQUIRED,
                ErrorCode.AUTH_TERMS_REQUIRED.getDefaultMessage(), details);
    }

    /**
     * 동의(또는 거절)를 기록한다.
     *
     * <p>버전은 <b>서버가 정한다.</b> 클라이언트가 보낸 버전을 믿으면 옛 버전에 동의한
     * 것으로 기록해 재동의를 회피할 수 있다. 사용자가 읽은 것과 다른 버전이 게시되는
     * 짧은 틈이 있지만, 그 경우 다음 로그인에서 재동의를 다시 요구받는다.</p>
     *
     * @return 남긴 이력 건수
     */
    @Transactional
    public int agree(Long userId, Map<String, Boolean> agreements, String ip, String userAgent) {
        if (!properties.getTerms().isEnabled() || agreements == null || agreements.isEmpty()) {
            return 0;
        }
        var published = new LinkedHashMap<String, Term>();
        termRepository.findCurrentPublished().forEach(t -> published.put(t.getCode(), t));

        var recorded = new ArrayList<String>();
        for (var entry : agreements.entrySet()) {
            Term term = published.get(entry.getKey());
            if (term == null) {
                // 모르는 코드는 조용히 버린다. 400 으로 막으면 앱이 옛 코드를 하나
                // 남겨 둔 것만으로 가입 전체가 실패한다
                log.debug("게시되지 않은 약관 코드에 대한 동의를 무시한다 — code={}", entry.getKey());
                continue;
            }
            boolean agreed = Boolean.TRUE.equals(entry.getValue());
            if (term.isRequired() && !agreed) {
                throw new ApiException(ErrorCode.AUTH_TERMS_REQUIRED,
                        ErrorCode.AUTH_TERMS_REQUIRED.getDefaultMessage(),
                        List.of(Map.of("field", "agreements." + term.getCode(),
                                "reason", "필수 약관은 거절할 수 없습니다.")));
            }
            agreementRepository.save(new TermAgreement(userId, term, agreed, ip, userAgent));
            recorded.add(term.getCode() + "@v" + term.getVersion() + (agreed ? "" : "(거절)"));
        }
        if (!recorded.isEmpty()) {
            auditService.record(AuditService.TERMS_AGREED, userId, userId, ip, userAgent,
                    Map.of("terms", recorded));
        }
        return recorded.size();
    }

    /** 내 동의 이력 — 최근 것이 위로. 지운 것은 없으므로 전부 나온다 */
    @Transactional(readOnly = true)
    public List<TermAgreement> myAgreements(Long userId) {
        return agreementRepository.findByUserIdOrderByAgreedAtDesc(userId);
    }

    private Map<String, TermAgreement> latestByCode(Long userId) {
        var out = new LinkedHashMap<String, TermAgreement>();
        agreementRepository.findLatestPerCode(userId).forEach(a -> out.put(a.getCode(), a));
        return out;
    }

    // ────────────────────── 관리 쪽 ──────────────────────

    @Transactional(readOnly = true)
    public List<Term> all() {
        return termRepository.findAllByOrderByDisplayOrderAscCodeAscVersionDesc();
    }

    @Transactional(readOnly = true)
    public Term get(Long id) {
        return termRepository.findById(id).orElseThrow(() -> ApiException.notFound("약관"));
    }

    /**
     * 새 약관 또는 <b>새 버전</b>을 만든다. 언제나 초안(미게시)으로 시작한다.
     *
     * <p>버전 번호는 서버가 매긴다 — 같은 코드의 최대값 + 1. 관리자가 직접 넣게 하면
     * 건너뛴 번호나 중복이 생기고, 그때 "몇 번에 동의한 것인가" 가 흐려진다.</p>
     */
    @Transactional
    public Term create(Term draft, Long actorId) {
        if (draft.getBody() == null && draft.getBodyUrl() == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "본문 또는 본문 주소 중 하나는 있어야 합니다.");
        }
        draft.setVersion(termRepository.maxVersion(draft.getCode()) + 1);
        draft.setPublishedAt(null);
        var saved = termRepository.save(draft);
        auditService.record(AuditService.TERM_CREATED, null, actorId, null, null,
                Map.of("code", saved.getCode(), "version", saved.getVersion()));
        return saved;
    }

    /**
     * 표준 약관 문안을 초안으로 넣는다 ({@link TermTemplates}).
     *
     * <p><b>이미 있는 코드는 건드리지 않는다.</b> 새 버전으로 쌓아 올리면, 관리자가
     * 예시를 보려고 눌렀을 뿐인데 공들여 쓴 약관 위에 예시 문안이 최신 버전으로
     * 앉는다. 여러 번 눌러도 결과가 같아야 안심하고 누를 수 있다.</p>
     *
     * @return 실제로 만들어진 것만. 건너뛴 코드는 빠져 있으므로 화면이 그 차이를 말해 준다
     */
    @Transactional
    public List<Term> seedTemplates(Long actorId) {
        var existing = termRepository.findAll().stream().map(Term::getCode).collect(Collectors.toSet());
        return TermTemplates.standard().stream()
                .filter(t -> !existing.contains(t.getCode()))
                .map(t -> create(t, actorId))
                .toList();
    }

    /**
     * 초안을 고친다.
     *
     * <p><b>게시된 약관의 제목·본문·필수 여부는 고칠 수 없다.</b> 사용자가 동의한 것은
     * "그 내용" 이고, 나중에 그 내용이 바뀌면 이력이 가리키는 대상이 달라진다.
     * 게시 후에 바꿀 수 있는 것은 표시 순서뿐이고, 나머지는 새 버전으로 낸다.</p>
     */
    @Transactional
    public Term update(Long id, Term patch, Long actorId) {
        Term term = get(id);
        if (patch.getDisplayOrder() != term.getDisplayOrder()) {
            term.setDisplayOrder(patch.getDisplayOrder());
        }
        if (term.isPublished()) {
            assertOnlyOrderChanged(term, patch);
            auditService.record(AuditService.TERM_UPDATED, null, actorId, null, null,
                    Map.of("code", term.getCode(), "version", term.getVersion(),
                            "changed", "displayOrder"));
            return term;
        }
        if (patch.getTitle() != null && !patch.getTitle().isBlank()) {
            term.setTitle(patch.getTitle().trim());
        }
        if (patch.getBody() != null) {
            term.setBody(patch.getBody().isBlank() ? null : patch.getBody());
        }
        if (patch.getBodyUrl() != null) {
            term.setBodyUrl(patch.getBodyUrl().isBlank() ? null : patch.getBodyUrl().trim());
        }
        term.setRequired(patch.isRequired());
        if (term.getBody() == null && term.getBodyUrl() == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "본문 또는 본문 주소 중 하나는 있어야 합니다.");
        }
        auditService.record(AuditService.TERM_UPDATED, null, actorId, null, null,
                Map.of("code", term.getCode(), "version", term.getVersion()));
        return term;
    }

    /** 게시본에 내용 변경이 섞여 오면 조용히 무시하지 않고 왜 안 되는지 말해 준다 */
    private void assertOnlyOrderChanged(Term term, Term patch) {
        boolean touched = (patch.getTitle() != null && !patch.getTitle().isBlank()
                        && !patch.getTitle().equals(term.getTitle()))
                || (patch.getBody() != null && !patch.getBody().equals(term.getBody()))
                || (patch.getBodyUrl() != null && !patch.getBodyUrl().equals(term.getBodyUrl()));
        if (touched) {
            throw ApiException.conflict(
                    "게시된 약관의 내용은 고칠 수 없습니다. 새 버전으로 게시하세요.");
        }
    }

    /**
     * 게시 — 이 시점부터 사용자에게 보이고, 필수라면 재동의 대상이 된다.
     *
     * <p>되돌리는 기능(게시 취소)을 두지 않았다. 이미 본 사람과 동의한 사람이 생긴
     * 뒤에 없던 일로 만들 수는 없기 때문이다. 잘못 게시했다면 고친 새 버전을 낸다.</p>
     */
    @Transactional
    public Term publish(Long id, Long actorId) {
        Term term = get(id);
        if (term.isPublished()) {
            throw ApiException.conflict("이미 게시된 약관입니다.");
        }
        term.setPublishedAt(Instant.now());
        auditService.record(AuditService.TERM_PUBLISHED, null, actorId, null, null,
                Map.of("code", term.getCode(), "version", term.getVersion(),
                        "required", term.isRequired()));
        log.info("약관 게시 — {} v{} (필수={}) actor={}",
                term.getCode(), term.getVersion(), term.isRequired(), actorId);
        return term;
    }

    /**
     * 삭제 — <b>동의 이력이 한 건이라도 있으면 거부한다.</b>
     *
     * <p>이력이 가리키는 대상이 사라지면 "무엇에 동의했는가" 를 되짚을 수 없다.
     * 오타 난 초안을 치우는 용도이지, 게시 이력을 지우는 용도가 아니다.</p>
     */
    @Transactional
    public void delete(Long id, Long actorId) {
        Term term = get(id);
        long agreements = agreementRepository.countByTermId(id);
        if (agreements > 0) {
            throw ApiException.conflict(
                    "동의 이력이 " + agreements + "건 있어 삭제할 수 없습니다. 증빙은 지우지 않습니다.");
        }
        termRepository.delete(term);
        auditService.record(AuditService.TERM_DELETED, null, actorId, null, null,
                Map.of("code", term.getCode(), "version", term.getVersion()));
    }

    @Transactional(readOnly = true)
    public Page<TermAgreement> agreementsOf(Long termId, Pageable pageable) {
        return agreementRepository.findByTermIdOrderByAgreedAtDesc(termId, pageable);
    }

    @Transactional(readOnly = true)
    public long agreementCount(Long termId) {
        return agreementRepository.countByTermId(termId);
    }
}
