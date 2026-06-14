import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AgentConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async start(tenantId: string, userId: string, agentId: string, hermesSessionId: string, title?: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.prisma.agentConversation.create({
      data: { tenantId, userId, agentId, hermesSessionId, title },
    });
  }

  async get(tenantId: string, userId: string, id: string) {
    const conv = await this.prisma.agentConversation.findFirst({
      where: { id, tenantId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== userId) throw new ForbiddenException('Not your conversation');
    return conv;
  }

  list(tenantId: string, userId: string) {
    return this.prisma.agentConversation.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, agentId: true, title: true, createdAt: true },
    });
  }

  addMessage(conversationId: string, role: 'user' | 'assistant' | 'tool', content: string, proposalId?: string) {
    return this.prisma.agentMessage.create({
      data: { conversationId, role, content, proposalId },
    });
  }

  /** Tenant-scoped guard used before streaming a turn. Returns the conversation. */
  async assertOwned(tenantId: string, userId: string, id: string) {
    const conv = await this.prisma.agentConversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== userId) throw new ForbiddenException('Not your conversation');
    return conv;
  }
}
