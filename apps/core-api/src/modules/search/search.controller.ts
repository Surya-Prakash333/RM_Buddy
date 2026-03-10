import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiHeader,
  ApiBody,
} from '@nestjs/swagger';

import { AuthGuard } from '../../common/guards/auth.guard';
import { RMIdentity } from '../../common/decorators/rm-identity.decorator';
import { SearchService, SearchResult, ClientSearchHit } from './search.service';
import { SearchQueryDto } from './dto/search.dto';
import { QueryEngineService } from './query-engine.service';
import { QueryResult } from './query-engine.dto';

interface RmIdentityPayload {
  rm_id: string;
  name?: string;
}

/**
 * SearchController exposes full-text search and fast client lookup endpoints.
 *
 * Base path: /api/v1/search
 *
 * All routes require a valid X-RM-Identity header processed by AuthGuard.
 */
@ApiTags('Search')
@ApiHeader({
  name: 'X-RM-Identity',
  description: 'Base64-encoded JSON: {"rm_id":"rm-001","name":"Arjun Shah"}',
  required: true,
})
@Controller('api/v1/search')
@UseGuards(AuthGuard)
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly queryEngineService: QueryEngineService,
  ) {}

  /**
   * Full-text search across clients, alerts, and meetings.
   * GET /api/v1/search?q=Sharma&limit=10
   */
  @Get()
  @ApiOperation({ summary: 'Full-text search across clients, alerts, and meetings' })
  @ApiQuery({ name: 'q', description: 'Search query (min 2 characters)', required: true })
  @ApiQuery({ name: 'limit', description: 'Max results per collection (max 50)', required: false })
  async search(
    @RMIdentity() rm: RmIdentityPayload,
    @Query() dto: SearchQueryDto,
  ): Promise<SearchResult> {
    this.logger.log(`search rm_id=${rm.rm_id} q="${dto.q}" limit=${dto.limit}`);
    return this.searchService.searchAll({
      rm_id: rm.rm_id,
      query: dto.q,
      limit: dto.limit ?? 10,
    });
  }

  /**
   * Fast client lookup by name — Redis first, MongoDB fallback.
   * GET /api/v1/search/client?name=Priya+Sharma
   */
  @Get('client')
  @ApiOperation({ summary: 'Fast client name lookup (<200ms) using Redis + MongoDB fallback' })
  @ApiQuery({ name: 'name', description: 'Client name to search', required: true })
  async findClient(
    @RMIdentity() rm: RmIdentityPayload,
    @Query('name') name: string,
  ): Promise<ClientSearchHit | null> {
    if (!name || name.trim().length < 2) {
      throw new BadRequestException('name query param must be at least 2 characters');
    }
    this.logger.log(`findClient rm_id=${rm.rm_id} name="${name}"`);
    return this.searchService.findClientByName(rm.rm_id, name);
  }

  /**
   * Rebuild Redis lookup maps for the RM's clients.
   * POST /api/v1/search/rebuild-index
   */
  @Post('rebuild-index')
  @ApiOperation({ summary: 'Rebuild Redis lookup maps for RM clients' })
  async rebuildIndex(
    @RMIdentity() rm: RmIdentityPayload,
  ): Promise<{ status: string; message: string }> {
    this.logger.log(`rebuildIndex rm_id=${rm.rm_id}`);
    await this.searchService.buildLookupMaps(rm.rm_id);
    return { status: 'success', message: 'Lookup maps rebuilt' };
  }

  /**
   * Natural-language query endpoint — parses and executes an NL query.
   * POST /api/v1/search/query
   *
   * Body: { "query": "How many Diamond clients do I have?" }
   */
  @Post('query')
  @ApiOperation({
    summary: 'Execute a natural-language query against RM data',
    description:
      'Parses the query into a structured intent and executes it against MongoDB. ' +
      'Returns a human-readable answer in Indian number formatting along with a widget hint.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          example: 'How many Diamond clients do I have?',
        },
      },
    },
  })
  async executeQuery(
    @RMIdentity() rm: RmIdentityPayload,
    @Body() body: { query: string },
  ): Promise<QueryResult> {
    if (!body?.query || body.query.trim().length < 2) {
      throw new BadRequestException('query must be at least 2 characters');
    }
    this.logger.log(`executeQuery rm_id=${rm.rm_id} query="${body.query}"`);
    const parsed = this.queryEngineService.parseQuery(body.query, rm.rm_id);
    return this.queryEngineService.executeQuery(parsed, rm.rm_id);
  }
}
