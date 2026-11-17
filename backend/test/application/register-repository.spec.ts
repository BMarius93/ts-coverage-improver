import { RegisterRepository } from '../../src/application/use-cases/register-repository';
import { CoverageThreshold } from '../../src/domain/coverage/coverage-threshold';
import { FixedClock, InMemoryRepositoryRepository, SequentialIds } from '../support/fakes';

describe('RegisterRepository', () => {
  const setup = () => {
    const repositories = new InMemoryRepositoryRepository();
    const useCase = new RegisterRepository(
      repositories,
      new SequentialIds('repo'),
      new FixedClock(),
      CoverageThreshold.default(),
    );
    return { repositories, useCase };
  };

  it('registers a repository', async () => {
    const { repositories, useCase } = setup();
    const result = await useCase.execute({ url: 'https://github.com/acme/widgets.git' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(true);
    expect(result.value.repository).toMatchObject({
      id: 'repo-00000001',
      url: 'https://github.com/acme/widgets',
      owner: 'acme',
      name: 'widgets',
      scanStatus: 'never_scanned',
      latestSnapshot: null,
      threshold: 80,
    });
    expect(await repositories.findById('repo-00000001')).not.toBeNull();
  });

  it('is idempotent for the same repository', async () => {
    const { useCase } = setup();
    await useCase.execute({ url: 'https://github.com/acme/widgets' });
    const second = await useCase.execute({ url: 'git@github.com:ACME/widgets.git' });
    expect(second.ok && second.value.created).toBe(false);
    expect(second.ok && second.value.repository.id).toBe('repo-00000001');
  });

  it('rejects an invalid URL', async () => {
    const { useCase } = setup();
    const result = await useCase.execute({ url: 'https://example.com/x' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('VALIDATION_ERROR');
  });
});
