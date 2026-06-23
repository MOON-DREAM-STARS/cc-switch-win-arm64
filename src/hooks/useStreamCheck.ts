import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  streamCheckProvider,
  type StreamCheckResult,
} from "@/lib/api/model-test";
import type { AppId } from "@/lib/api";

/**
 * 供应商连通性检查。
 *
 * 只探测 base_url 是否可达（任何 HTTP 响应都算可达），不发真实大模型请求。
 * 刻意 **不** 重置故障转移熔断器——可达 ≠ 配置正确，一个端口通但鉴权废的供应商
 * 不应被误判为"健康"而切回线上。熔断器只由真实转发流量驱动（见 proxy/forwarder.rs）。
 */
export function useStreamCheck(appId: AppId) {
  const { t } = useTranslation();
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());

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
            t("streamCheck.reachable", {
              providerName: providerName,
              responseTimeMs: result.responseTimeMs,
              defaultValue: `${providerName} 连通正常 (${result.responseTimeMs}ms)`,
            }),
            { closeButton: true },
          );
        } else if (result.status === "degraded") {
          toast.warning(
            t("streamCheck.reachableSlow", {
              providerName: providerName,
              responseTimeMs: result.responseTimeMs,
              defaultValue: `${providerName} 连通但较慢 (${result.responseTimeMs}ms)`,
            }),
          );
        } else {
          // 仅当无法建立连接（DNS / 连接被拒 / TLS / 超时）才会到这里
          toast.error(
            t("streamCheck.unreachable", {
              providerName: providerName,
              message: result.message,
              defaultValue: `${providerName} 无法连通: ${result.message}`,
            }),
            {
              description: t("streamCheck.unreachableHint", {
                defaultValue:
                  "无法建立连接（DNS / 连接 / TLS / 超时）。请检查 base_url 与网络。",
              }),
              duration: 8000,
              closeButton: true,
            },
          );
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
    [appId, t],
  );

  const isChecking = useCallback(
    (providerId: string) => checkingIds.has(providerId),
    [checkingIds],
  );

  return { checkProvider, isChecking };
}
