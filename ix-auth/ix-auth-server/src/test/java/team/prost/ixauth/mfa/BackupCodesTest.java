package team.prost.ixauth.mfa;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 백업 코드 — 한 번 쓰면 사라지는가, 그리고 평문이 남지 않는가.
 *
 * <p>소모되지 않으면 "1회용" 이 말뿐이 되고, 종이 한 장이 유출됐을 때 그 코드가
 * 계속 통한다.</p>
 */
class BackupCodesTest {

    @Test
    @DisplayName("요청한 개수만큼, 사람이 옮겨 적을 수 있는 모양으로 만든다")
    void generatesRequestedCount() {
        var codes = BackupCodes.generate(10);

        assertThat(codes).hasSize(10);
        assertThat(codes).doesNotHaveDuplicates();
        assertThat(codes).allMatch(c -> c.matches("[A-Z2-9]{5}-[A-Z2-9]{5}"));
        assertThat(codes).as("헷갈리는 글자(I·O·0·1)는 쓰지 않는다")
                .allMatch(c -> !c.contains("I") && !c.contains("O")
                        && !c.contains("0") && !c.contains("1"));
    }

    @Test
    @DisplayName("저장값에는 평문이 남지 않는다 — 다시 보여 줄 방법이 없어야 한다")
    void storesOnlyHashes() {
        var codes = BackupCodes.generate(3);
        String stored = BackupCodes.store(codes);

        for (String code : codes) {
            assertThat(stored).doesNotContain(code);
            assertThat(stored).doesNotContain(code.replace("-", ""));
        }
        assertThat(BackupCodes.remaining(stored)).isEqualTo(3);
    }

    @Test
    @DisplayName("맞는 코드를 쓰면 소모돼 남은 개수가 줄어든다")
    void consumesOnUse() {
        var codes = BackupCodes.generate(5);
        String stored = BackupCodes.store(codes);

        var left = BackupCodes.consume(stored, codes.get(2));

        assertThat(left).isPresent();
        assertThat(BackupCodes.remaining(left.get())).isEqualTo(4);
    }

    @Test
    @DisplayName("같은 코드를 두 번 쓰면 거부한다 — 이게 1회용의 전부다")
    void rejectsReuse() {
        var codes = BackupCodes.generate(5);
        String stored = BackupCodes.store(codes);

        String afterFirst = BackupCodes.consume(stored, codes.get(0)).orElseThrow();

        assertThat(BackupCodes.consume(afterFirst, codes.get(0)))
                .as("이미 쓴 코드가 다시 통하면 안 된다").isEmpty();
        assertThat(BackupCodes.remaining(afterFirst)).isEqualTo(4);
    }

    @Test
    @DisplayName("나머지 코드는 그대로 살아 있다")
    void keepsOtherCodes() {
        var codes = BackupCodes.generate(4);
        String afterFirst = BackupCodes.consume(BackupCodes.store(codes), codes.get(0))
                .orElseThrow();

        for (String remaining : codes.subList(1, codes.size())) {
            assertThat(BackupCodes.consume(afterFirst, remaining))
                    .as("한 번의 입력으로 하나만 소모돼야 한다").isPresent();
        }
    }

    @Test
    @DisplayName("하이픈·공백·소문자를 무시한다 — 사용자는 적어 둔 종이를 보고 친다")
    void normalizesInput() {
        var codes = List.copyOf(BackupCodes.generate(1));
        String stored = BackupCodes.store(codes);
        String typed = codes.get(0).replace("-", " ").toLowerCase(java.util.Locale.ROOT);

        assertThat(BackupCodes.consume(stored, typed)).isPresent();
    }

    @Test
    @DisplayName("틀린 값·빈 값·다 쓴 상태는 조용히 거부한다")
    void rejectsUnknown() {
        String stored = BackupCodes.store(BackupCodes.generate(2));

        assertThat(BackupCodes.consume(stored, "AAAAA-AAAAA")).isEmpty();
        assertThat(BackupCodes.consume(stored, "")).isEmpty();
        assertThat(BackupCodes.consume(stored, null)).isEmpty();
        assertThat(BackupCodes.consume("", "AAAAA-AAAAA")).isEmpty();
        assertThat(BackupCodes.remaining(null)).isZero();
    }

    @Test
    @DisplayName("0개로 설정하면 아무 코드도 통하지 않는다")
    void supportsZeroCodes() {
        String stored = BackupCodes.store(BackupCodes.generate(0));

        assertThat(BackupCodes.remaining(stored)).isZero();
        assertThat(BackupCodes.consume(stored, "AAAAA-AAAAA")).isEmpty();
    }
}
