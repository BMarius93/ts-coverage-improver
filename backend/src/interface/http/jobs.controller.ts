import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { GetDashboard } from '../../application/use-cases/get-dashboard';
import { RequestImprovement } from '../../application/use-cases/request-improvement';
import { JobView } from '../../application/views';
import { unwrapOrThrow } from './domain-error.mapper';
import { RequestImprovementDto, requestImprovementSchema } from './dto/job.dto';
import { ZodValidationPipe } from './zod-validation.pipe';

@Controller()
export class JobsController {
  constructor(
    private readonly requestImprovement: RequestImprovement,
    private readonly dashboard: GetDashboard,
  ) {}

  /** Queues an improvement job; a worker picks it up. Poll GET /jobs/:id for progress. */
  @Post('jobs')
  async create(
    @Body(new ZodValidationPipe(requestImprovementSchema)) body: RequestImprovementDto,
  ): Promise<JobView> {
    return unwrapOrThrow(await this.requestImprovement.execute(body));
  }

  @Get('jobs/:id')
  async get(@Param('id') id: string): Promise<JobView> {
    return unwrapOrThrow(await this.dashboard.getJob(id));
  }

  @Get('repositories/:id/jobs')
  async listForRepository(@Param('id') id: string): Promise<JobView[]> {
    return unwrapOrThrow(await this.dashboard.listJobs(id));
  }
}
