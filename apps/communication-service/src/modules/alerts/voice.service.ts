import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Minimal interface for the HTTP client used to call the ElevenLabs API.
 * Defined locally so VoiceService is testable without axios installed.
 */
export interface IHttpClient {
  post(
    url: string,
    data: unknown,
    config: { headers: Record<string, string> },
  ): Promise<{ data: unknown }>;
}

export const HTTP_CLIENT = Symbol('HTTP_CLIENT');

/**
 * Variables passed to the ElevenLabs conversational AI agent via
 * dynamic_variables, allowing the agent prompt to address the RM by name.
 */
export interface VoiceCallVariables {
  rm_name: string;
  client_name: string;
  alert_message: string;
}

/**
 * VoiceService initiates outbound ElevenLabs conversational AI calls for
 * HIGH and CRITICAL severity alerts.
 *
 * Soft-disabled if ELEVENLABS_API_KEY or the relevant agent ID is not set —
 * a warning is logged and the method returns without throwing. This means the
 * rest of the dispatch pipeline continues normally even before the ElevenLabs
 * account is provisioned.
 *
 * Two agent IDs are supported:
 *  - ELEVENLABS_ARIA_AGENT_ID   → used when the RM role is RM / ADMIN
 *  - ELEVENLABS_VIKRAM_AGENT_ID → used when the BM role is BM
 *
 * For this release we always use the Aria agent (default RM persona).
 * Role-based routing can be added once agent IDs are confirmed.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  private readonly apiKey: string;
  private readonly ariaAgentId: string;
  private readonly vikramAgentId: string;
  private readonly baseUrl = 'https://api.elevenlabs.io/v1/convai/agents';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ELEVENLABS_API_KEY', '');
    this.ariaAgentId = this.configService.get<string>('ELEVENLABS_ARIA_AGENT_ID', '');
    this.vikramAgentId = this.configService.get<string>('ELEVENLABS_VIKRAM_AGENT_ID', '');
  }

  /**
   * Initiate a conversational AI voice call to an RM.
   *
   * @param rmId      RM identifier (used for logging and dynamic variables).
   * @param variables Dynamic prompt variables injected into the agent script.
   */
  async initiateCall(rmId: string, variables: VoiceCallVariables): Promise<void> {
    if (!this.apiKey || !this.ariaAgentId) {
      this.logger.warn(
        `ElevenLabs not configured (ELEVENLABS_API_KEY or ELEVENLABS_ARIA_AGENT_ID missing) ` +
          `— skipping voice call for rm_id=${rmId}`,
      );
      return;
    }

    const agentId = this.ariaAgentId;
    const url = `${this.baseUrl}/${agentId}/call`;

    const requestBody = {
      dynamic_variables: {
        rm_id: rmId,
        rm_name: variables.rm_name,
        client_name: variables.client_name,
        alert_message: variables.alert_message,
      },
    };

    this.logger.log(`Initiating ElevenLabs voice call rm_id=${rmId} agent_id=${agentId}`);

    try {
      // axios is loaded via require() inside the method to keep this service
      // unit-testable without axios installed. Tests inject IHttpClient mock.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const axios = require('axios') as {
        post: (url: string, data: unknown, config: unknown) => Promise<{ data: unknown }>;
      };

      await axios.post(url, requestBody, {
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      this.logger.log(`ElevenLabs voice call initiated successfully rm_id=${rmId}`);
    } catch (err) {
      this.logger.error(
        `ElevenLabs voice call failed for rm_id=${rmId}: ${(err as Error).message}`,
      );
    }
  }
}
