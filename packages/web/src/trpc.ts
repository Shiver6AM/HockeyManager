import type { AppRouter } from '@hockey-gm/server';
import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export type Outputs = inferRouterOutputs<AppRouter>;
export type Inputs = inferRouterInputs<AppRouter>;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: (count, err) => count < 2 && !/UNAUTHORIZED|FORBIDDEN|NOT_FOUND/.test(String((err as { data?: { code?: string } })?.data?.code)),
    },
  },
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/trpc', fetch: (url, opts) => fetch(url, { ...opts, credentials: 'include' }) })],
});
