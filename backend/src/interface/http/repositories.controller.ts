import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GetDashboard } from '../../application/use-cases/get-dashboard';
import { RegisterRepository } from '../../application/use-cases/register-repository';
import { ScanCoverage } from '../../application/use-cases/scan-coverage';
import { FileView, RepositoryView } from '../../application/views';
import { unwrapOrThrow } from './domain-error.mapper';
import {
  ListFilesQueryDto,
  listFilesQuerySchema,
  RegisterRepositoryDto,
  registerRepositorySchema,
} from './dto/repository.dto';
import { ZodValidationPipe } from './zod-validation.pipe';

@Controller('repositories')
export class RepositoriesController {
  constructor(
    private readonly registerRepository: RegisterRepository,
    private readonly scanCoverage: ScanCoverage,
    private readonly dashboard: GetDashboard,
  ) {}

  /** 201 when registered, 200 when the repository was already registered. */
  @Post()
  async register(
    @Body(new ZodValidationPipe(registerRepositorySchema)) body: RegisterRepositoryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RepositoryView> {
    const { repository, created } = unwrapOrThrow(await this.registerRepository.execute({ url: body.url }));
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return repository;
  }

  @Get()
  list(): Promise<RepositoryView[]> {
    return this.dashboard.listRepositories();
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<RepositoryView> {
    return unwrapOrThrow(await this.dashboard.getRepository(id));
  }

  /** Starts a scan in the background; poll GET /repositories/:id for `scanStatus`. */
  @Post(':id/scan')
  @HttpCode(HttpStatus.ACCEPTED)
  async scan(@Param('id') id: string): Promise<RepositoryView> {
    return unwrapOrThrow(await this.scanCoverage.execute(id)).repository;
  }

  @Get(':id/files')
  async files(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listFilesQuerySchema)) query: ListFilesQueryDto,
  ): Promise<FileView[]> {
    return unwrapOrThrow(await this.dashboard.listFiles(id, { belowThresholdOnly: query.belowThreshold }));
  }
}
