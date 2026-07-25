import { FastifyPluginAsync } from 'fastify';
import * as aiService from '../services/aiService.js';

/**
 * AI Recommendation Engine Routes
 * Handles AI-generated formulation variants
 */

const aiRoutes = async (fastify) => {
  // Generate alternative formulations
  fastify.post('/formulations/:formulationId/generate', async (request, reply) => {
    const { formulationId } = request.params;
    const {
      count = 10,
      generation_type = 'optimization',
      constraints = {},
    } = request.body;

    try {
      const variants = await aiService.generateAlternativeFormulations(formulationId, {
        count: Math.min(count, 50), // Cap at 50
        generation_type,
        constraints,
      });

      return reply.code(201).send({
        data: variants,
        count: variants.length,
        message: `Generated ${variants.length} formulation variants`,
      });
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Get AI variants for a formulation
  fastify.get('/formulations/:formulationId/variants', async (request, reply) => {
    const { formulationId } = request.params;
    const filters = {
      status: request.query.status,
      limit: parseInt(request.query.limit || '50'),
      offset: parseInt(request.query.offset || '0'),
    };

    try {
      const variants = await aiService.getAIVariants(formulationId, filters);
      return { data: variants };
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Accept an AI variant (create formulation from it)
  fastify.post('/variants/:variantId/accept', async (request, reply) => {
    const { variantId } = request.params;
    const { user_id } = request.body;

    try {
      const formulation = await aiService.acceptAIVariant(variantId, user_id);
      return reply.code(201).send({
        data: formulation,
        message: 'AI variant accepted and formulation created',
      });
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Get AI variant by ID
  fastify.get('/variants/:variantId', async (request, reply) => {
    const { variantId } = request.params;
    
    // This would require a new service method, simplified for now
    return reply.code(501).send({ error: 'Not implemented yet' });
  });
};

export default aiRoutes;








