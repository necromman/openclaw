package team.prost.ixauth.mail;

import lombok.extern.slf4j.Slf4j;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import team.prost.ixauth.config.IxAuthProperties;

import java.util.Properties;

/**
 * jar 가 SMTP 로 직접 보낸다 — 기본 권장 모드.
 *
 * <p>설정 네 줄(host·port·username·password)만 넣으면 비밀번호 찾기가 동작한다.
 * 이 제품이 없애려는 수고가 바로 그 부분이다.</p>
 */
@Slf4j
public class SmtpMailSender implements MailSender {

    private final IxAuthProperties.Mail config;
    private final JavaMailSenderImpl delegate;

    public SmtpMailSender(IxAuthProperties.Mail config) {
        this.config = config;
        this.delegate = build(config);
    }

    private static JavaMailSenderImpl build(IxAuthProperties.Mail config) {
        var smtp = config.getSmtp();
        var sender = new JavaMailSenderImpl();
        sender.setHost(smtp.getHost());
        sender.setPort(smtp.getPort());
        sender.setUsername(smtp.getUsername());
        sender.setPassword(smtp.getPassword());
        sender.setDefaultEncoding("UTF-8");

        var props = new Properties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.auth", String.valueOf(!smtp.getUsername().isBlank()));
        props.put("mail.smtp.starttls.enable", String.valueOf(smtp.isStarttls()));
        if (smtp.isSsl()) {
            props.put("mail.smtp.ssl.enable", "true");
        }
        // 타임아웃을 두지 않으면 SMTP 가 응답하지 않을 때 요청 스레드가 묶인다
        String timeout = String.valueOf(smtp.getTimeout().toMillis());
        props.put("mail.smtp.connectiontimeout", timeout);
        props.put("mail.smtp.timeout", timeout);
        props.put("mail.smtp.writetimeout", timeout);
        sender.setJavaMailProperties(props);
        return sender;
    }

    @Override
    public void send(MailMessage message) {
        var mail = new SimpleMailMessage();
        mail.setFrom(config.getFrom());
        mail.setTo(message.to());
        mail.setSubject(message.subject());
        mail.setText(message.body());
        try {
            delegate.send(mail);
            // 받는 주소는 남기되 링크는 남기지 않는다 — 로그를 본 사람이 계정을 가져갈 수 있다
            log.info("메일 발송: to={} kind={}", message.to(), message.kind());
        } catch (Exception e) {
            // 여기서 삼키지 않는다. 발송 실패로 요청이 실패하지 않게 하는 것은 여전하지만,
            // 그 판단은 MailDeliveryService 한 곳에서 한다 — 통로마다 각자 삼키면
            // 운영자가 "안 갔다" 를 알 방법이 없다(G21)
            throw new MailSendException(e.getMessage() == null
                    ? e.getClass().getSimpleName() : e.getMessage(), e);
        }
    }

    @Override
    public boolean isOperational() {
        return !config.getSmtp().getHost().isBlank();
    }
}
