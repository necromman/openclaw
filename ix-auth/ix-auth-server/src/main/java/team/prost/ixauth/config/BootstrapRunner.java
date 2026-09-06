package team.prost.ixauth.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.repository.RoleRepository;
import team.prost.ixauth.repository.UserRepository;
import team.prost.ixauth.security.SigningKeyService;

/**
 * 부팅 시 자동 구성 — 서명 키 + 초기 관리자.
 *
 * <p>"설치하면 바로 로그인이 된다" 가 이 제품의 약속이다. 사용자가 SQL 을 실행하거나
 * 관리자 계정을 손으로 만들지 않아도 되게 한다.</p>
 */
@Component
@RequiredArgsConstructor
@Order(1)
@Slf4j
public class BootstrapRunner implements ApplicationRunner {

    private final IxAuthProperties properties;
    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;
    private final SigningKeyService signingKeyService;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        var key = signingKeyService.ensureActiveKey();
        log.info("IX-Auth 서명 키 준비 완료 — kid={} alg={}", key.getKid(), key.getAlgorithm());

        seedAdmin();
    }

    private void seedAdmin() {
        String email = properties.getAdmin().getEmail();
        if (userRepository.existsByEmailIgnoreCase(email)) {
            log.debug("초기 관리자가 이미 있습니다 — 건너뜁니다");
            return;
        }

        var admin = new User(email, properties.getAdmin().getName(),
                passwordEncoder.encode(properties.getAdmin().getPassword()));
        roleRepository.findByCode("ADMIN").ifPresent(admin.getRoles()::add);
        userRepository.save(admin);

        log.info("초기 관리자 계정을 생성했습니다 — {}", email);
        log.warn("첫 로그인 후 비밀번호를 반드시 변경하세요.");
    }
}
