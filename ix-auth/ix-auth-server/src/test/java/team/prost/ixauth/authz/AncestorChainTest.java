package team.prost.ixauth.authz;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 조상 경로 체인 — L2 상속의 전부다.
 *
 * <p>여기가 틀리면 "상위 폴더 권한이 하위에 안 먹거나", 더 나쁘게는
 * "형제 파일 권한이 새는" 일이 생긴다.</p>
 */
class AncestorChainTest {

    @Test
    @DisplayName("파일 경로는 자신부터 루트까지 거슬러 올라간다")
    void filePath() {
        assertThat(ResourceAuthzService.ancestorChain("/contracts/2026/a.pdf"))
                .containsExactly("/contracts/2026/a.pdf", "/contracts/2026/", "/contracts/", "/");
    }

    @Test
    @DisplayName("폴더 경로도 같은 방식으로 거슬러 올라간다")
    void folderPath() {
        assertThat(ResourceAuthzService.ancestorChain("/contracts/2026/"))
                .containsExactly("/contracts/2026/", "/contracts/", "/");
    }

    @Test
    @DisplayName("루트 바로 아래는 루트까지만")
    void shallowPath() {
        assertThat(ResourceAuthzService.ancestorChain("/a.pdf"))
                .containsExactly("/a.pdf", "/");
    }

    @Test
    @DisplayName("경로가 아닌 식별자는 정확 매칭만 — 상속 없음")
    void identifier() {
        assertThat(ResourceAuthzService.ancestorChain("doc-4821"))
                .containsExactly("doc-4821");
    }

    @Test
    @DisplayName("형제는 체인에 들어오지 않는다 (prefix 조회였다면 샜을 것)")
    void siblingsNotIncluded() {
        assertThat(ResourceAuthzService.ancestorChain("/contracts/2026/a.pdf"))
                .doesNotContain("/contracts/2026/b.pdf", "/contracts/2025/");
    }

    @Test
    @DisplayName("빈 값은 빈 체인 — 판정은 거부로 끝난다")
    void blank() {
        assertThat(ResourceAuthzService.ancestorChain(null)).isEmpty();
        assertThat(ResourceAuthzService.ancestorChain("  ")).isEmpty();
    }

    @Test
    @DisplayName("루트 자체")
    void root() {
        assertThat(ResourceAuthzService.ancestorChain("/")).containsExactly("/");
    }
}
