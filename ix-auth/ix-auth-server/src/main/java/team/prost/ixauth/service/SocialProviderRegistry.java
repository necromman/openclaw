package team.prost.ixauth.service;

import org.springframework.stereotype.Component;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.social.GoogleProvider;
import team.prost.ixauth.social.KakaoProvider;
import team.prost.ixauth.social.MicrosoftProvider;
import team.prost.ixauth.social.NaverProvider;
import team.prost.ixauth.social.SocialProvider;
import tools.jackson.databind.ObjectMapper;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * 켜져 있는 provider 만 담는다.
 *
 * <p>꺼진 provider 를 요청하면 404 다 — 400 이 아니라. 설정하지 않은 로그인 방식의
 * 존재 여부까지 알려 줄 이유가 없다.</p>
 */
@Component
public class SocialProviderRegistry {

    private final Map<SocialProvider.Kind, SocialProvider> providers =
            new EnumMap<>(SocialProvider.Kind.class);
    private final IxAuthProperties properties;

    public SocialProviderRegistry(IxAuthProperties properties, ObjectMapper mapper) {
        this.properties = properties;
        var social = properties.getSocial();
        if (!social.isEnabled()) {
            return;
        }
        register(SocialProvider.Kind.MICROSOFT, social.getMicrosoft(),
                new MicrosoftProvider(social.getMicrosoft(), mapper));
        register(SocialProvider.Kind.KAKAO, social.getKakao(),
                new KakaoProvider(social.getKakao(), mapper));
        register(SocialProvider.Kind.NAVER, social.getNaver(),
                new NaverProvider(social.getNaver(), mapper));
        register(SocialProvider.Kind.GOOGLE, social.getGoogle(),
                new GoogleProvider(social.getGoogle(), mapper));
    }

    private void register(SocialProvider.Kind kind, IxAuthProperties.Social.Provider config,
                          SocialProvider provider) {
        // client-id 가 없으면 켠 것으로 치지 않는다 — 눌렀을 때 provider 화면에서
        // 실패하는 것보다 아예 버튼이 없는 편이 낫다
        if (config.isEnabled() && !config.getClientId().isBlank()) {
            providers.put(kind, provider);
        }
    }

    public SocialProvider require(String name) {
        SocialProvider.Kind kind;
        try {
            kind = SocialProvider.Kind.of(name);
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.AUTH_SOCIAL_DISABLED);
        }
        SocialProvider provider = providers.get(kind);
        if (provider == null) {
            throw new ApiException(ErrorCode.AUTH_SOCIAL_DISABLED);
        }
        return provider;
    }

    /** 앱이 로그인 화면에 어떤 버튼을 그릴지 정하는 데 쓴다 */
    public List<String> enabledProviders() {
        return providers.keySet().stream().map(Enum::name).toList();
    }

    public boolean isEnabled() {
        return properties.getSocial().isEnabled() && !providers.isEmpty();
    }
}
