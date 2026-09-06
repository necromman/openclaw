package team.prost.ixauth.settings;

import java.util.List;

/**
 * 설정 하나의 정의 — 관리 화면은 <b>이것만 보고</b> 입력 칸을 그린다.
 *
 * <p>화면을 따로 만들지 않는 이유: 설정이 늘 때마다 화면 작업이 따라붙으면
 * 결국 둘이 어긋난다. 정의에 등록하면 화면이 저절로 생기게 해 두면 그 일이 없다.</p>
 *
 * @param key      yml 경로와 같은 표기 (`account.signup-mode`)
 * @param type     화면이 어떤 입력을 그릴지 정한다
 * @param group    화면의 묶음 (계정 · 메일 · 보안 …)
 * @param label    사람이 읽는 이름
 * @param help     <b>왜 이 설정이 있는지</b>. 켜고 끄면 무엇이 달라지는지 적는다 —
 *                 이름만으로는 판단할 수 없는 것이 대부분이다
 * @param options  ENUM 일 때의 선택지
 * @param requiresRestart 즉시 반영되지 않는 것 (DB 접속처럼)
 * @param warning  잘못 바꾸면 사고가 나는 설정에 붙인다. 화면에서 눈에 띄게 보여 준다
 * @param dependsOnKey   이 설정이 의미를 갖는 조건 — 다른 설정의 키
 * @param dependsOnValue 그 설정이 이 값일 때만 화면에 보인다.
 *                       SMTP 를 고르지 않았는데 SMTP 호스트 칸이 떠 있으면
 *                       "적었는데 왜 안 되지" 가 된다
 */
public record SettingDefinition(
        String key,
        Type type,
        String group,
        String label,
        String help,
        List<Option> options,
        boolean requiresRestart,
        String warning,
        String dependsOnKey,
        String dependsOnValue) {

    public enum Type {
        /** 켬/끔 */
        BOOLEAN,
        /** 정수 */
        INTEGER,
        /** `30m` · `7d` 같은 기간 */
        DURATION,
        /** 자유 문자열 */
        STRING,
        /** 선택지 중 하나 */
        ENUM,
        /** 쉼표로 구분한 목록 */
        LIST
    }

    /** @param label 화면에 보이는 설명. 코드값만 보이면 무엇을 고르는지 알 수 없다 */
    public record Option(String value, String label) {
    }

    public static Builder of(String key, Type type) {
        return new Builder(key, type);
    }

    public static final class Builder {
        private final String key;
        private final Type type;
        private String group = "기타";
        private String label;
        private String help = "";
        private List<Option> options = List.of();
        private boolean requiresRestart;
        private String warning;
        private String dependsOnKey;
        private String dependsOnValue;

        private Builder(String key, Type type) {
            this.key = key;
            this.type = type;
            this.label = key;
        }

        public Builder group(String v) {
            this.group = v;
            return this;
        }

        public Builder label(String v) {
            this.label = v;
            return this;
        }

        public Builder help(String v) {
            this.help = v;
            return this;
        }

        public Builder options(Option... v) {
            this.options = List.of(v);
            return this;
        }

        public Builder requiresRestart() {
            this.requiresRestart = true;
            return this;
        }

        public Builder warning(String v) {
            this.warning = v;
            return this;
        }

        /** 다른 설정이 특정 값일 때만 보이게 한다 */
        public Builder shownWhen(String key, String value) {
            this.dependsOnKey = key;
            this.dependsOnValue = value;
            return this;
        }

        public SettingDefinition build() {
            return new SettingDefinition(key, type, group, label, help,
                    options, requiresRestart, warning, dependsOnKey, dependsOnValue);
        }
    }
}
