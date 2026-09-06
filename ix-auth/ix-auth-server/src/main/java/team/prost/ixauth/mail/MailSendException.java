package team.prost.ixauth.mail;

/**
 * 발송 통로가 메일을 넘기지 못했다.
 *
 * <p><b>이 예외는 {@link MailDeliveryService} 밖으로 나가지 않는다.</b> 발송 실패가
 * 요청을 실패시키면 안 되기 때문이다 — 재설정 요청은 "메일을 보냈다면 보냈다" 고만
 * 답해야 하고(계정 존재 여부 보호), 그 답이 SMTP 서버 상태에 따라 갈리면 감추는
 * 의미가 없다.</p>
 *
 * <p>그런데도 예외를 만든 이유는 <b>삼키는 자리를 한 곳으로 모으기 위해서다.</b>
 * 통로마다 각자 삼키면 "안 갔다" 를 아무도 모른다 — 지금까지가 그랬다(G21).
 * 통로는 실패를 던지고, 그것을 받아 이력에 남기고 재시도를 걸고 삼키는 일은
 * {@link MailDeliveryService} 하나만 한다.</p>
 */
public class MailSendException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public MailSendException(String message, Throwable cause) {
        super(message, cause);
    }

    public MailSendException(String message) {
        super(message);
    }
}
