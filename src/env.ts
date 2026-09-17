import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  CF_ACCESS_TEAM_DOMAIN: {
    public: true,
    schema: (val) => val || ''
  },
  CF_ACCESS_AUD: {
    public: false,
    schema: (val) => val || ''
  },
  ACCESS_BYPASS_DEV: {
    public: false,
    schema: (val) => val || ''
  }
});
