/**
 * Thin axios client with JWT bearer injection + 401 handling.
 *
 * All API calls go through this client so token management lives in one place.
 * Access token is stored in localStorage under 'access_token'; refresh is TODO
 * (next milestone once backend exposes /api/login/refresh/).
 */
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";

const BASE_URL = process.env.REACT_APP_API_BASE_URL ?? "http://localhost:8000/api";

export const ACCESS_TOKEN_KEY = "access_token";
export const REFRESH_TOKEN_KEY = "refresh_token";

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      // token missing / expired — clear and let caller redirect to login
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
    return Promise.reject(err);
  }
);
