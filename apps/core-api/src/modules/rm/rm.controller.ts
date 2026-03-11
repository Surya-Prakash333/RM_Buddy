import { Controller, Get, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('api/v1/rm')
export class RmController {
  private readonly logger = new Logger(RmController.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * GET /api/v1/rm/list
   * Public endpoint — no auth required.
   * Returns all active RM profiles from rm_profiles collection for the login dropdown.
   */
  @Get('list')
  async listRms(): Promise<unknown> {
    this.logger.log('GET /api/v1/rm/list');
    const docs = await this.connection.db!
      .collection('rm_profiles')
      .find({ is_active: true })
      .project({ rm_id: 1, rm_name: 1, rm_email: 1, rm_code: 1, branch: 1, region: 1, role: 1 })
      .toArray();

    return {
      status: 'success',
      data: docs.map((d) => ({
        rm_id: d.rm_id as string,
        rm_name: d.rm_name as string,
        rm_email: d.rm_email as string,
        rm_code: d.rm_code as string,
        branch: d.branch as string,
        region: d.region as string,
        role: d.role as string,
      })),
      timestamp: new Date().toISOString(),
    };
  }
}
