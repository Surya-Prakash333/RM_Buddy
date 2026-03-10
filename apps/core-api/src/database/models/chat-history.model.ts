import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChatHistoryDocument = ChatHistory & Document;

@Schema({ timestamps: true, collection: 'chat_history' })
export class ChatHistory {
  @Prop({ required: true, unique: true, index: true })
  session_id!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop({
    type: [{
      message_id: String,
      role: String,
      content: String,
      widgets: [Object],
      agent_id: String,
      model_used: String,
      tokens_used: Number,
      timestamp: Date,
    }],
  })
  messages!: Array<{
    message_id: string;
    role: string;
    content: string;
    widgets: any[];
    agent_id: string;
    model_used: string;
    tokens_used: number;
    timestamp: Date;
  }>;

  @Prop()
  started_at!: Date;

  @Prop()
  last_message_at!: Date;

  @Prop()
  message_count!: number;

  @Prop()
  total_tokens!: number;

  @Prop()
  total_cost!: number;
}

export const ChatHistorySchema = SchemaFactory.createForClass(ChatHistory);

ChatHistorySchema.index({ rm_id: 1, last_message_at: -1 });
ChatHistorySchema.index({ last_message_at: 1 }, { expireAfterSeconds: 604800 });
