import { FastifyPluginAsync } from 'fastify';
import * as compatibilityService from '../services/compatibilityService.js';

/**
 * Compatibility & Risk Engine Routes
 * Handles compatibility scoring and risk evaluation
 */

const compatibilityRoutes = async (fastify) => {
  // Get compatibility score for two ingredients
  fastify.get('/ingredients/:ingredientAId/:ingredientBId', async (request, reply) => {
    const { ingredientAId, ingredientBId } = request.params;
    
    try {
      const compatibility = await compatibilityService.getCompatibilityScore(
        ingredientAId,
        ingredientBId
      );
      return { data: compatibility };
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Evaluate formulation compatibility
  fastify.get('/formulations/:formulationId', async (request, reply) => {
    const { formulationId } = request.params;
    
    try {
      const evaluation = await compatibilityService.evaluateFormulationCompatibility(formulationId);
      return { data: evaluation };
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Batch compute compatibility matrix (admin endpoint)
  fastify.post('/batch-compute', async (request, reply) => {
    const { ingredient_ids } = request.body;
    
    try {
      const result = await compatibilityService.batchComputeCompatibilityMatrix(ingredient_ids);
      return { 
        data: result,
        message: 'Compatibility matrix computation started',
      };
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });
};

export default compatibilityRoutes;








