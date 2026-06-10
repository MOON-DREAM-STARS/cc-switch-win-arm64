import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  streamCheckProvider,
  type StreamCheckResult,
} from "@/lib/api/model-test";
import type { AppId } from "@/lib/api";
import { useResetCircuitBreaker } from "@/lib/query/failover";

export function useStreamCheck(appId: AppId) {
  const { t } = useTranslation();
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const resetCircuitBreaker = useResetCircuitBreaker();

  const checkProvider = useCallback(
    async (
      providerId: string,
      providerName: string,
    ): Promise<StreamCheckResult | null> => {
      setCheckingIds((prev) => new Set(prev).add(providerId));

      try {
        const result = await streamCheckProvider(appId, providerId);

        if (result.auditMode === "all_routes" && result.routeResults?.length) {
          const totalRoutes = result.routeResults.length;
          const passedRoutes = result.routeResults.filter(
            (item) => item.result.success,
          ).length;
          const routeDetails = result.routeResults
            .map((item) => {
              const target =
                item.targetProviderName || item.targetProviderId || "unknown";
              if (!item.result.success) {
                return `${item.routeKey} → ${target}: ${item.result.message}`;
              }
              if (item.result.status === "degraded") {
                return `${item.routeKey} → ${target}: 较慢${item.result.responseTimeMs != null ? ` (${item.result.responseTimeMs}ms)` : ""}`;
              }
              return `${item.routeKey} → ${target}: 成功${item.result.responseTimeMs != null ? ` (${item.result.responseTimeMs}ms)` : ""}`;
            })
            .join("；");

          if (result.status === "operational") {
            toast.success(
              t("streamCheck.auditOperational", {
                providerName,
                passedRoutes,
                totalRoutes,
                defaultValue: `${providerName} 组合巡检完成 (${passedRoutes}/${totalRoutes})`,
              }),
              {
                description: routeDetails,
                duration: 12000,
                closeButton: true,
              },
            );
            resetCircuitBreaker.mutate({ providerId, appType: appId });
          } else if (result.status === "degraded") {
            toast.warning(
              t("streamCheck.auditDegraded", {
                providerName,
                passedRoutes,
                totalRoutes,
                defaultValue: `${providerName} 组合巡检完成，部分路由较慢 (${passedRoutes}/${totalRoutes})`,
              }),
              {
                description: routeDetails,
                duration: 12000,
                closeButton: true,
              },
            );
            resetCircuitBreaker.mutate({ providerId, appType: appId });
          } else {
            toast.error(
              t("streamCheck.auditFailed", {
                providerName,
                passedRoutes,
                totalRoutes,
                defaultValue: `${providerName} 组合巡检失败 (${passedRoutes}/${totalRoutes})`,
              }),
              {
                description: routeDetails,
                duration: 12000,
                closeButton: true,
              },
            );
          }

          return result;
        }

        if (result.status === "operational") {
          toast.success(
            t("streamCheck.operational", {
              providerName: providerName,
              responseTimeMs: result.responseTimeMs,
              defaultValue: `${providerName} 运行正常 (${result.responseTimeMs}ms)`,
            }),
            { closeButton: true },
          );

          // 测试通过后重置熔断器状态
          resetCircuitBreaker.mutate({ providerId, appType: appId });
        } else if (result.status === "degraded") {
          toast.warning(
            t("streamCheck.degraded", {
              providerName: providerName,
              responseTimeMs: result.responseTimeMs,
              defaultValue: `${providerName} 响应较慢 (${result.responseTimeMs}ms)`,
            }),
          );

          // 降级状态也重置熔断器，因为至少能通信
          resetCircuitBreaker.mutate({ providerId, appType: appId });
        } else if (result.errorCategory === "modelNotFound") {
          // 专门处理"模型不存在/已下架"：指向配置入口，比通用 404 文案更有指导性
          toast.error(
            t("streamCheck.modelNotFound", {
              providerName: providerName,
              model: result.modelUsed,
              defaultValue: `${providerName} 测试模型 ${result.modelUsed} 不存在或已下架`,
            }),
            {
              description: t("streamCheck.modelNotFoundHint", {
                defaultValue: "",
              }),
              duration: 10000,
              closeButton: true,
            },
          );
        } else if (result.errorCategory === "quotaExceeded") {
          toast.warning(
            t("streamCheck.quotaExceeded", {
              providerName: providerName,
              defaultValue: `${providerName} Coding Plan quota has been exceeded`,
            }),
            {
              description: t("streamCheck.quotaExceededHint", {
                defaultValue: "",
              }),
              duration: 10000,
              closeButton: true,
            },
          );
        } else {
          const httpStatus = result.httpStatus;
          const hintKey = httpStatus
            ? `streamCheck.httpHint.${httpStatus >= 500 ? "5xx" : httpStatus}`
            : null;
          const description =
            (hintKey ? t(hintKey, { defaultValue: "" }) : "") || undefined;

          // 401/403/400 = 检查被拒（供应商可能正常）；429/5xx = 临时问题
          const isProbeRejection =
            httpStatus != null &&
            ([401, 403, 400, 429].includes(httpStatus) || httpStatus >= 500);

          if (isProbeRejection) {
            toast.warning(
              t("streamCheck.rejected", {
                providerName: providerName,
                message: result.message,
                defaultValue: `${providerName} 检查被拒: ${result.message}`,
              }),
              { description, duration: 8000, closeButton: true },
            );
          } else {
            toast.error(
              t("streamCheck.failed", {
                providerName: providerName,
                message: result.message,
                defaultValue: `${providerName} 检查失败: ${result.message}`,
              }),
              { description, duration: 8000, closeButton: true },
            );
          }
        }

        return result;
      } catch (e) {
        toast.error(
          t("streamCheck.error", {
            providerName: providerName,
            error: String(e),
            defaultValue: `${providerName} 检查出错: ${String(e)}`,
          }),
        );
        return null;
      } finally {
        setCheckingIds((prev) => {
          const next = new Set(prev);
          next.delete(providerId);
          return next;
        });
      }
    },
    [appId, t, resetCircuitBreaker],
  );

  const isChecking = useCallback(
    (providerId: string) => checkingIds.has(providerId),
    [checkingIds],
  );

  return { checkProvider, isChecking };
}
