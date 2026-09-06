package team.prost.ixauth.domain;

public enum UserStatus {
    /** 정상 */
    ACTIVE,
    /** 로그인 실패 누적으로 잠김 — 시간 경과 시 자동 해제 */
    LOCKED,
    /** 관리자가 비활성화 (소프트 삭제 포함) */
    DISABLED,
    /** 초대 수락 전 — 초대 메일의 링크로 비밀번호를 정해야 한다 */
    PENDING,
    /**
     * 가입은 했으나 관리자 승인 대기 (signup-mode=APPROVAL).
     *
     * <p>PENDING 과 구분하는 이유 — 저쪽은 '본인이 할 일이 남았다' 이고
     * 이쪽은 '관리자가 할 일이 남았다' 다. 사용자에게 안내할 말이 다르고,
     * 관리자 화면에서 처리해야 할 목록도 이쪽만이다.</p>
     */
    PENDING_APPROVAL
}
