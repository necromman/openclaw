package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import team.prost.ixauth.domain.MailTemplate;

import java.util.List;
import java.util.Optional;

public interface MailTemplateRepository extends JpaRepository<MailTemplate, Long> {

    Optional<MailTemplate> findByKindAndLocale(String kind, String locale);

    List<MailTemplate> findAllByOrderByKindAscLocaleAsc();
}
