/**
 * React Query-like Query Client
 * Manages data caching, refetching, and optimistic updates
 */

export class QueryClient {
  constructor() {
    this.cache = new Map();
    this.observers = new Map();
    this.mutations = new Map();
  }

  setQueryData(key, data) {
    this.cache.set(JSON.stringify(key), data);
    this.notifyObservers(key);
  }

  getQueryData(key) {
    return this.cache.get(JSON.stringify(key));
  }

  async fetchQuery(key, fetcher) {
    const stringKey = JSON.stringify(key);
    const cached = this.cache.get(stringKey);
    
    if (cached) return cached;

    try {
      const data = await fetcher();
      this.cache.set(stringKey, data);
      this.notifyObservers(key);
      return data;
    } catch (error) {
      console.error('Query fetch error:', error);
      throw error;
    }
  }

  subscribe(key, callback) {
    const stringKey = JSON.stringify(key);
    if (!this.observers.has(stringKey)) {
      this.observers.set(stringKey, []);
    }
    this.observers.get(stringKey).push(callback);

    return () => {
      const callbacks = this.observers.get(stringKey);
      const index = callbacks.indexOf(callback);
      if (index !== -1) callbacks.splice(index, 1);
    };
  }

  notifyObservers(key) {
    const stringKey = JSON.stringify(key);
    const callbacks = this.observers.get(stringKey) || [];
    callbacks.forEach(cb => cb(this.cache.get(stringKey)));
  }

  async mutate(mutationKey, mutationFn, onSuccess) {
    try {
      const result = await mutationFn();
      if (onSuccess) onSuccess(result);
      return result;
    } catch (error) {
      console.error('Mutation error:', error);
      throw error;
    }
  }

  // Optimistic update: update cache immediately, revert on error
  async optimisticUpdate(queryKey, updateFn, rollbackFn) {
    const stringKey = JSON.stringify(queryKey);
    const previousData = this.cache.get(stringKey);

    try {
      // Update UI immediately
      const optimisticData = updateFn(previousData);
      this.cache.set(stringKey, optimisticData);
      this.notifyObservers(queryKey);

      // Perform actual mutation
      await rollbackFn();
      return optimisticData;
    } catch (error) {
      // Revert on error
      this.cache.set(stringKey, previousData);
      this.notifyObservers(queryKey);
      throw error;
    }
  }

  invalidateQueries(key) {
    this.cache.delete(JSON.stringify(key));
    this.notifyObservers(key);
  }

  clear() {
    this.cache.clear();
    this.observers.clear();
  }
}

export const queryClient = new QueryClient();
