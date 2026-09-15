import { getStorageConfiguration } from '../data/persistentStore.js';
import { updateProfileSchema } from '../schemas/authSchemas.js';
import { USER_ROLES } from '../services/authorization.js';
import { updateUserProfile } from '../services/supabaseClient.js';

export default async function authRoutes(server) {
  server.get('/auth/me', async (request) => ({
    data: {
      id: request.user?.id,
      email: request.user?.email,
      display_name: request.profile?.display_name || null,
      role: request.profile?.role || USER_ROLES.ADMIN,
    },
  }));

  server.put('/auth/profile', async (request) => {
    const { display_name } = updateProfileSchema.parse(request.body);
    if (getStorageConfiguration().mode !== 'supabase') {
      request.profile = { ...request.profile, display_name };
      return { data: request.profile };
    }
    const profile = await updateUserProfile(request.user.id, display_name);
    request.profile = profile;
    return { data: profile };
  });
}
