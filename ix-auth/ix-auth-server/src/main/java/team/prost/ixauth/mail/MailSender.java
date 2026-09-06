package team.prost.ixauth.mail;

/**
 * 메일 발송 통로. 구현은 SMTP · 웹훅 · 로그 세 가지다.
 *
 * <p><b>발송 실패가 요청을 실패시키면 안 된다.</b> 재설정 요청은 "메일을 보냈다면
 * 보냈다" 고만 답해야 하고(계정 존재 여부 보호), 그 답은 SMTP 서버 상태와 무관해야
 * 한다.</p>
 *
 * <p>다만 <b>삼키는 것은 통로가 아니라 {@link MailDeliveryService} 다.</b> 예전에는
 * 통로마다 각자 삼켰고, 그래서 운영자가 "안 갔다" 를 알 방법이 없었다(G21).
 * 지금은 통로가 실패를 {@link MailSendException} 으로 던지고, 그것을 받아 이력에
 * 남기고 재시도를 걸고 삼키는 일은 한 곳에서 한다.</p>
 */
public interface MailSender {

    /**
     * @throws MailSendException 넘기지 못했을 때. 호출자는 {@link MailDeliveryService} 뿐이고,
     *                           이 예외가 요청 처리 경로로 새어 나가지 않는다
     */
    void send(MailMessage message);

    /** 설정이 실제로 보낼 수 있는 상태인지 — 부팅 시 경고에 쓴다 */
    boolean isOperational();
}
