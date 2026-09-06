package team.prost.ixauth.authz;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import team.prost.ixauth.domain.ResourceType;
import team.prost.ixauth.repository.ResourceTypeRepository;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 키 정규화 — 부여할 때와 물을 때 같은 문자열이 나와야 한다.
 *
 * <p>어긋나면 준 권한이 걸리지 않고, 그 결과는 "권한 없음" 과 구분되지 않아
 * 운영에서 원인을 찾기 어렵다. 그래서 규칙을 여기서 고정한다.</p>
 */
class ResourceKeyNormalizerTest {

    private ResourceKeyNormalizer normalizer;

    /** DB 없이 돌린다 — 규칙 자체를 보는 테스트라 저장소는 흉내만 낸다 */
    private static class FakeRepo implements ResourceTypeRepository {
        private final Map<String, ResourceType> data = new HashMap<>();

        void put(ResourceType t) {
            data.put(t.getCode(), t);
        }

        @Override
        public Optional<ResourceType> findById(String code) {
            return Optional.ofNullable(data.get(code));
        }

        @Override
        public List<ResourceType> findAllByOrderByCodeAsc() {
            return List.copyOf(data.values());
        }

        // 아래는 이 테스트에서 쓰지 않는다
        @Override public <S extends ResourceType> S save(S e) {
            throw new UnsupportedOperationException();
        }
        @Override public <S extends ResourceType> List<S> saveAll(Iterable<S> e) {
            throw new UnsupportedOperationException();
        }
        @Override public List<ResourceType> findAll() {
            return List.copyOf(data.values());
        }
        @Override public List<ResourceType> findAllById(Iterable<String> ids) {
            throw new UnsupportedOperationException();
        }
        @Override public boolean existsById(String id) {
            return data.containsKey(id);
        }
        @Override public long count() {
            return data.size();
        }
        @Override public void deleteById(String id) {
            data.remove(id);
        }
        @Override public void delete(ResourceType e) {
            data.remove(e.getCode());
        }
        @Override public void deleteAllById(Iterable<? extends String> ids) {
            throw new UnsupportedOperationException();
        }
        @Override public void deleteAll(Iterable<? extends ResourceType> e) {
            throw new UnsupportedOperationException();
        }
        @Override public void deleteAll() {
            data.clear();
        }
        @Override public void flush() { }
        @Override public <S extends ResourceType> S saveAndFlush(S e) {
            throw new UnsupportedOperationException();
        }
        @Override public <S extends ResourceType> List<S> saveAllAndFlush(Iterable<S> e) {
            throw new UnsupportedOperationException();
        }
        @Override public void deleteAllInBatch(Iterable<ResourceType> e) { }
        @Override public void deleteAllByIdInBatch(Iterable<String> ids) { }
        @Override public void deleteAllInBatch() { }
        @Override public ResourceType getOne(String id) {
            throw new UnsupportedOperationException();
        }
        @Override public ResourceType getById(String id) {
            throw new UnsupportedOperationException();
        }
        @Override public ResourceType getReferenceById(String id) {
            throw new UnsupportedOperationException();
        }
        @Override public <S extends ResourceType> Optional<S> findOne(
                org.springframework.data.domain.Example<S> ex) {
            throw new UnsupportedOperationException();
        }
        @Override public <S extends ResourceType> List<S> findAll(
                org.springframework.data.domain.Example<S> ex) {
            throw new UnsupportedOperationException();
        }
        @Override public <S extends ResourceType> List<S> findAll(
                org.springframework.data.domain.Example<S> ex,
                org.springframework.data.domain.Sort sort) {
            throw new UnsupportedOperationException();
        }
        @Override public <S extends ResourceType> org.springframework.data.domain.Page<S> findAll(
                org.springframework.data.domain.Example<S> ex,
                org.springframework.data.domain.Pageable p) {
            throw new UnsupportedOperationException();
        }
        @Override public <S extends ResourceType> long count(
                org.springframework.data.domain.Example<S> ex) {
            return 0;
        }
        @Override public <S extends ResourceType> boolean exists(
                org.springframework.data.domain.Example<S> ex) {
            return false;
        }
        @Override public <S extends ResourceType, R> R findBy(
                org.springframework.data.domain.Example<S> ex,
                java.util.function.Function<org.springframework.data.repository.query
                        .FluentQuery.FetchableFluentQuery<S>, R> fn) {
            throw new UnsupportedOperationException();
        }
        @Override public List<ResourceType> findAll(org.springframework.data.domain.Sort sort) {
            return findAll();
        }
        @Override public org.springframework.data.domain.Page<ResourceType> findAll(
                org.springframework.data.domain.Pageable p) {
            throw new UnsupportedOperationException();
        }
    }

    @BeforeEach
    void setUp() {
        var repo = new FakeRepo();
        repo.put(new ResourceType("file", "파일", ResourceType.KeyFormat.PATH));

        var s3 = new ResourceType("s3", "S3", ResourceType.KeyFormat.S3);
        s3.setCaseSensitive(false);
        repo.put(s3);

        repo.put(new ResourceType("doc", "문서", ResourceType.KeyFormat.OPAQUE));

        var ext = new ResourceType("nextcloud", "Nextcloud", ResourceType.KeyFormat.PATH);
        ext.setDelegated(true);
        repo.put(ext);

        normalizer = new ResourceKeyNormalizer(repo);
    }

    @Test
    @DisplayName("경로 — 앞의 / 를 강제하고 중복 구분자를 줄인다")
    void pathIsNormalized() {
        assertThat(normalizer.normalize("file", "contracts/a.pdf")).isEqualTo("/contracts/a.pdf");
        assertThat(normalizer.normalize("file", "/contracts//a.pdf")).isEqualTo("/contracts/a.pdf");
        assertThat(normalizer.normalize("file", "  /contracts/a.pdf  "))
                .isEqualTo("/contracts/a.pdf");
        // 윈도우 표기도 같은 문자열로 — 같은 파일이 두 키로 갈리면 안 된다
        assertThat(normalizer.normalize("file", "\\contracts\\a.pdf")).isEqualTo("/contracts/a.pdf");
    }

    @Test
    @DisplayName("경로 — 대소문자를 구분한다 (리눅스 파일시스템)")
    void pathIsCaseSensitive() {
        assertThat(normalizer.normalize("file", "/Contracts/A.pdf")).isEqualTo("/Contracts/A.pdf");
    }

    @Test
    @DisplayName("상위 경로 참조는 막는다 — 권한 밖을 가리킬 수 있다")
    void rejectsParentTraversal() {
        assertThatThrownBy(() -> normalizer.normalize("file", "/contracts/../../etc/passwd"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> normalizer.normalize("file", "/contracts/.."))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("S3 — s3:// 표기와 버킷/키 표기를 같은 것으로 본다")
    void s3FormsCollapse() {
        String expected = "/docs/2026/a.pdf";
        assertThat(normalizer.normalize("s3", "s3://docs/2026/a.pdf")).isEqualTo(expected);
        assertThat(normalizer.normalize("s3", "docs/2026/a.pdf")).isEqualTo(expected);
        assertThat(normalizer.normalize("s3", "/docs/2026/a.pdf")).isEqualTo(expected);
        // 버킷은 대소문자를 구분하지 않는다
        assertThat(normalizer.normalize("s3", "S3://Docs/2026/A.pdf")).isEqualTo(expected);
    }

    @Test
    @DisplayName("식별자 — 경로가 아니므로 구분자를 손대지 않는다")
    void opaqueKeepsShape() {
        assertThat(normalizer.normalize("doc", "doc-4821")).isEqualTo("doc-4821");
        assertThat(normalizer.normalize("doc", "  doc-4821 ")).isEqualTo("doc-4821");
    }

    @Test
    @DisplayName("등록되지 않은 종류는 경로 규칙으로 다룬다 — 조회가 통째로 실패하는 것보다 낫다")
    void unknownTypeFallsBackToPath() {
        assertThat(normalizer.normalize("whatever", "a/b")).isEqualTo("/a/b");
    }

    @Test
    @DisplayName("저장소가 자체 권한을 가진 종류를 구분한다")
    void delegatedIsFlagged() {
        assertThat(normalizer.isDelegated("nextcloud")).isTrue();
        assertThat(normalizer.isDelegated("file")).isFalse();
        assertThat(normalizer.isDelegated("unknown")).isFalse();
    }
}
