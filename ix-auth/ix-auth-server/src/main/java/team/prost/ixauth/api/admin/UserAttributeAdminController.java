package team.prost.ixauth.api.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.domain.UserAttributeDef;
import team.prost.ixauth.service.UserAttributeService;

import java.util.List;
import java.util.Locale;

/**
 * 사용자 속성 정의 관리.
 *
 * <p>여기 정의를 등록하면 사용자 생성·수정·가입이 그대로 검사한다. 정의가 하나도
 * 없으면 아무 검사도 하지 않으므로, <b>이 화면을 쓰지 않는 설치는 지금까지와 똑같이
 * 동작한다.</b></p>
 */
@RestController
@RequestMapping("/admin/user-attributes")
@RequiredArgsConstructor
public class UserAttributeAdminController {

    private final UserAttributeService service;
    private final AdminGuard guard;

    /** @param options ENUM 일 때의 선택지. 쉼표로 구분한다 */
    public record SaveRequest(@NotBlank String key, String label, String type,
                              Boolean required, String options, Integer displayOrder,
                              String description) {
    }

    public record DefView(String key, String label, String type, boolean required,
                          List<String> options, int displayOrder, String description) {
    }

    @GetMapping
    public ApiResponse<List<DefView>> list() {
        guard.require(AdminGuard.USERS_READ);
        return ApiResponse.ok(service.definitions().stream().map(UserAttributeAdminController::toView).toList());
    }

    /** 등록과 수정을 하나로 둔다 — 키가 곧 식별자라 나눌 이유가 없다 */
    @PostMapping
    public ApiResponse<DefView> save(@Valid @RequestBody SaveRequest req) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        var def = new UserAttributeDef();
        def.setKey(req.key());
        def.setLabel(req.label() == null || req.label().isBlank() ? req.key() : req.label().trim());
        def.setType(parseType(req.type()));
        def.setRequired(Boolean.TRUE.equals(req.required()));
        def.setOptions(req.options() == null || req.options().isBlank() ? null : req.options());
        def.setDisplayOrder(req.displayOrder() == null ? 0 : req.displayOrder());
        def.setDescription(req.description());
        return ApiResponse.ok(toView(service.save(def, actor.userId())));
    }

    /** 정의만 지운다 — 사용자에게 저장된 값은 그대로 둔다 */
    @DeleteMapping("/{key}")
    public ResponseEntity<Void> delete(@PathVariable String key) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        service.delete(key, actor.userId());
        return ResponseEntity.noContent().build();
    }

    private static UserAttributeDef.AttrType parseType(String raw) {
        if (raw == null || raw.isBlank()) {
            return UserAttributeDef.AttrType.STRING;
        }
        try {
            return UserAttributeDef.AttrType.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "알 수 없는 타입입니다: " + raw + " (STRING·NUMBER·BOOLEAN·ENUM·DATE)");
        }
    }

    private static DefView toView(UserAttributeDef d) {
        return new DefView(d.getKey(), d.getLabel(), d.getType().name(), d.isRequired(),
                d.optionList(), d.getDisplayOrder(), d.getDescription());
    }
}
