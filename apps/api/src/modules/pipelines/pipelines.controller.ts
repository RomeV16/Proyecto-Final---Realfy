import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { PipelinesService } from './pipelines.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelinesService: PipelinesService) {}

  /**
   * POST /pipelines — Create a new pipeline.
   * Admin/Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.pipelinesService.create(body);
  }

  /**
   * GET /pipelines — List all pipelines for the current tenant.
   * Any authenticated user.
   */
  @Get()
  async findAll() {
    return this.pipelinesService.findAll();
  }

  /**
   * GET /pipelines/:id — Get a single pipeline with stages.
   * Any authenticated user.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.pipelinesService.findOne(id);
  }

  /**
   * PATCH /pipelines/:id — Update pipeline fields.
   * Admin/Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.pipelinesService.update(id, body);
  }

  /**
   * DELETE /pipelines/:id — Remove a pipeline.
   * Admin/Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.pipelinesService.remove(id);
  }

  /**
   * POST /pipelines/:id/stages — Add a stage to a pipeline.
   * Admin/Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post(':id/stages')
  async addStage(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.pipelinesService.addStage(id, body);
  }

  /**
   * PATCH /pipelines/:pipelineId/stages/reorder — Batch reorder stages.
   * Must be BEFORE the parameterized :stageId route to avoid NestJS matching
   * "reorder" as a stageId value.
   * Admin/Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Patch(':pipelineId/stages/reorder')
  async reorderStages(
    @Param('pipelineId') pipelineId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.pipelinesService.reorderStages(pipelineId, body);
  }

  /**
   * PATCH /pipelines/:pipelineId/stages/:stageId — Update a stage.
   * Admin/Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Patch(':pipelineId/stages/:stageId')
  async updateStage(
    @Param('pipelineId') pipelineId: string,
    @Param('stageId') stageId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.pipelinesService.updateStage(pipelineId, stageId, body);
  }

  /**
   * DELETE /pipelines/:pipelineId/stages/:stageId — Remove a stage.
   * Admin/Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Delete(':pipelineId/stages/:stageId')
  async removeStage(
    @Param('pipelineId') pipelineId: string,
    @Param('stageId') stageId: string,
  ) {
    return this.pipelinesService.removeStage(pipelineId, stageId);
  }
}
