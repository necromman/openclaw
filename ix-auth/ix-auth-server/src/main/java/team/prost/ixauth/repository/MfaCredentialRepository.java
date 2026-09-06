package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import team.prost.ixauth.domain.MfaCredential;

import java.util.Optional;

public interface MfaCredentialRepository extends JpaRepository<MfaCredential, Long> {

    Optional<MfaCredential> findByUserIdAndType(Long userId, String type);

    /**
     * 로그인 경로에서 "이 사람에게 2단계가 걸려 있는가" 만 묻는다.
     *
     * <p>행 전체를 읽지 않는 이유 — 시크릿은 필요할 때만 메모리에 올린다.</p>
     */
    boolean existsByUserIdAndTypeAndConfirmedAtIsNotNull(Long userId, String type);

    void deleteByUserIdAndType(Long userId, String type);
}
