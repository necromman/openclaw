package team.prost.ixauth.mail;

import lombok.extern.slf4j.Slf4j;

/**
 * 보내지 않고 링크를 로그에 남긴다 — 개발용.
 *
 * <p>이것이 기본값인 이유: SMTP 설정 없이도 개발자가 재설정 흐름을 끝까지
 * 눌러 볼 수 있어야 한다. 로그에 뜬 링크를 그대로 브라우저에 붙이면 된다.</p>
 *
 * <p>운영에서 이 모드로 뜨면 아무도 메일을 받지 못한다. 그래서
 * {@link #isOperational()} 이 false 이고, 부팅 시 경고가 나간다.</p>
 */
@Slf4j
public class LogMailSender implements MailSender {

    @Override
    public void send(MailMessage message) {
        log.warn("""

                ┌─ 메일이 실제로 발송되지 않았습니다 (transport=LOG) ─────────────
                │ 받는 사람 : {}
                │ 제목      : {}
                │ 링크      : {}
                └─ 운영에서는 ixauth.mail.transport 를 SMTP 또는 WEBHOOK 으로 ──""",
                message.to(), message.subject(), message.link());
    }

    @Override
    public boolean isOperational() {
        return false;
    }
}
