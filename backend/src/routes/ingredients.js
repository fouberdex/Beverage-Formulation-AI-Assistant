import { FastifyPluginAsync } from 'fastify';
import * as ingredientService from '../services/ingredientService.js';

/**
 * Ingredient Intelligence System Routes
 * Handles CRUD operations for 1,200+ ingredients
 */

const ingredientRoutes = async (fastify) => {
  // Get all ingredients with filters
  fastify.get('/', async (request, reply) => {
    const filters = {
      category: request.query.category,
      regulatory_status: request.query.regulatory_status,
      is_active: request.query.is_active !== undefined ? request.query.is_active === 'true' : true,
      search: request.query.search,
      limit: parseInt(request.query.limit || '100'),
      offset: parseInt(request.query.offset || '0'),
    };

    const ingredients = await ingredientService.getAllIngredients(filters);
    const count = await ingredientService.getIngredientCount();

    return {
      data: ingredients,
      pagination: {
        total: count,
        limit: filters.limit,
        offset: filters.offset,
        has_more: filters.offset + filters.limit < count,
      },
    };
  });

  // Get ingredient by ID
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;
    const ingredient = await ingredientService.getIngredientById(id);

    if (!ingredient) {
      return reply.code(404).send({ error: 'Ingredient not found' });
    }

    return { data: ingredient };
  });

  // Get ingredient by code
  fastify.get('/code/:code', async (request, reply) => {
    const { code } = request.params;
    const ingredient = await ingredientService.getIngredientByCode(code);

    if (!ingredient) {
      return reply.code(404).send({ error: 'Ingredient not found' });
    }

    return { data: ingredient };
  });

  // Create ingredient
  fastify.post('/', async (request, reply) => {
    try {
      const ingredient = await ingredientService.createIngredient(request.body);
      return reply.code(201).send({ data: ingredient });
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        return reply.code(409).send({ error: 'Ingredient code already exists' });
      }
      throw error;
    }
  });

  // Update ingredient
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const ingredient = await ingredientService.updateIngredient(id, request.body);
      if (!ingredient) {
        return reply.code(404).send({ error: 'Ingredient not found' });
      }
      return { data: ingredient };
    } catch (error) {
      throw error;
    }
  });

  // Delete ingredient (soft delete)
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const ingredient = await ingredientService.deleteIngredient(id);

    if (!ingredient) {
      return reply.code(404).send({ error: 'Ingredient not found' });
    }

    return { data: ingredient, message: 'Ingredient deleted successfully' };
  });

  // Get ingredient categories
  fastify.get('/meta/categories', async (request, reply) => {
    const categories = await ingredientService.getIngredientCategories();
    return { data: categories };
  });

  // Get ingredient statistics
  fastify.get('/meta/stats', async (request, reply) => {
    const count = await ingredientService.getIngredientCount();
    const categories = await ingredientService.getIngredientCategories();

    return {
      data: {
        total_ingredients: count,
        total_categories: categories.length,
        categories: categories,
      },
    };
  });
};

export default ingredientRoutes;








