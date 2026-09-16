import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Upload, Film, Image, Layers, Pause, Play, Wrench } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { t } from "../i18n";

export type WallpaperValues = {
  codexAppImageOverlayEnabled: boolean;
  codexAppImageOverlayPath: string;
  codexAppImageOverlayOpacity: number;
  codexAppImageOverlayFitMode: "fill" | "fit" | "stretch" | "tile" | "center";
  codexAppWallpaperMuted: boolean;
  codexAppWallpaperPaused: boolean;
  codexAppWallpaperEnginePath: string;
};

type Source = { kind: "image" | "video" | "web" | "scene"; title: string; path: string; entry: string; root: string };

export function WallpaperSettings({ value, onChange, onSave, onReset }: {
  value: WallpaperValues;
  onChange: (patch: Partial<WallpaperValues>) => void;
  onSave: () => Promise<unknown>;
  onReset: () => Promise<unknown>;
}) {
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const selection = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; selection.current++; };
  }, []);
  useEffect(() => {
    const revision = ++selection.current;
    setSource(null);
    setPreviewFailed(false);
    if (!value.codexAppImageOverlayPath.trim()) return;
    const timer = setTimeout(() => {
      void invoke<Source>("inspect_wallpaper", { path: value.codexAppImageOverlayPath.trim() })
        .then(result => {
          if (mounted.current && selection.current === revision) { setSource(result); setMessage(""); }
        })
        .catch(error => {
          if (mounted.current && selection.current === revision) setMessage(String(error));
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [value.codexAppImageOverlayPath]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let active = true;
    const sync = () => {
      if (document.hidden || value.codexAppWallpaperPaused) element.pause();
      else void element.play().catch(error => {
        // Changing selection or StrictMode cleanup aborts an in-flight play().
        // That is not a decode error for the replacement video.
        if (active && error?.name !== "AbortError") setPreviewFailed(true);
      });
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { active = false; document.removeEventListener("visibilitychange", sync); element.pause(); };
  }, [source?.entry, value.codexAppWallpaperPaused]);

  const choose = async (directory: boolean) => {
    setBusy(true);
    setMessage("");
    const revision = ++selection.current;
    try {
      const path = await open({
        directory, multiple: false,
        title: directory ? t("选择 Wallpaper Engine 壁纸目录") : t("上传壁纸媒体"),
        ...(directory ? {} : { filters: [{ name: t("图片与视频"), extensions: ["mp4", "webm", "m4v", "mov", "ogv", "gif", "png", "apng", "webp", "jpg", "jpeg", "bmp"] }] }),
      });
      if (typeof path !== "string") return;
      const result = await invoke<Source>(directory ? "inspect_wallpaper" : "import_wallpaper_media", { path });
      if (!mounted.current || selection.current !== revision) return;
      setSource(result);
      onChange({ codexAppImageOverlayPath: result.path, codexAppImageOverlayEnabled: true, codexAppWallpaperPaused: false });
    } catch (error) {
      if (mounted.current && selection.current === revision) setMessage(String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const chooseEngine = async () => {
    setBusy(true);
    try {
      const path = await open({ directory: false, multiple: false, title: t("选择 Wallpaper Engine 程序"),
        filters: [{ name: "Wallpaper Engine", extensions: ["exe"] }] });
      if (typeof path === "string" && mounted.current) onChange({ codexAppWallpaperEnginePath: path });
    } catch (error) { if (mounted.current) setMessage(String(error)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try { await run(); } catch (error) { if (mounted.current) setMessage(String(error)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const preview = source && (source.kind === "image" || source.kind === "video") ? convertFileSrc(source.entry) : "";
  const objectFit = ({ fill: "cover", fit: "contain", stretch: "fill", tile: "contain", center: "none" } as const)[value.codexAppImageOverlayFitMode];

  return <section className="wallpaper-settings" aria-label={t("动态壁纸")}>
    <div className="wallpaper-heading">
      <div><h3>{t("动态壁纸")}</h3><p>{t("上传视频或动图，也可以选择 Wallpaper Engine 的单个项目目录。")}</p></div>
      <label className="inline-toggle">
        <input type="checkbox" checked={value.codexAppImageOverlayEnabled} disabled={busy}
          onChange={e => onChange({ codexAppImageOverlayEnabled: e.currentTarget.checked })} />
        <span>{t("启用壁纸")}</span>
      </label>
    </div>
    <div className="wallpaper-layout">
      <div className="wallpaper-preview">
        {preview && !previewFailed ? source?.kind === "video" ?
          <video ref={video} src={preview} muted loop playsInline preload="metadata" style={{ objectFit }}
            onError={() => setPreviewFailed(true)} /> :
          <img src={preview} alt={source?.title || ""} style={{ objectFit }} onError={() => setPreviewFailed(true)} /> :
          <div className="wallpaper-placeholder">
            {source?.kind === "scene" ? <Layers /> : source?.kind === "video" ? <Film /> : <Image />}
            <strong>{source?.title || t("尚未选择壁纸")}</strong>
            <span>{previewFailed ? t("预览失败，请检查文件或视频编码。") :
              source?.kind === "scene" ? t("原生场景 · 由 Wallpaper Engine 渲染") :
              source?.kind === "web" ? t("Web 场景 · 在 Codex 中隔离运行") : "MP4 · WebM · GIF · PNG / APNG"}</span>
          </div>}
        {source ? <span className="wallpaper-kind">{source.kind.toUpperCase()}</span> : null}
      </div>
      <div className="wallpaper-controls">
        <div className="toolbar">
          <Button disabled={busy} onClick={() => void choose(false)}><Upload className="h-4 w-4" />{t("上传壁纸媒体")}</Button>
          <Button disabled={busy} variant="secondary" onClick={() => void choose(true)}><FolderOpen className="h-4 w-4" />{t("选择项目目录")}</Button>
        </div>
        <label className="wallpaper-field"><span>{t("壁纸文件或项目路径")}</span>
          <Input value={value.codexAppImageOverlayPath} disabled={busy}
            onChange={e => onChange({ codexAppImageOverlayPath: e.currentTarget.value })} placeholder="MP4 / WebM / GIF / PNG / project.json" />
        </label>
        <div className="wallpaper-options">
          <label className="wallpaper-field"><span>{t("透明度")} {value.codexAppImageOverlayOpacity}%</span>
            <Input type="range" min={1} max={100} value={value.codexAppImageOverlayOpacity}
              onChange={e => onChange({ codexAppImageOverlayOpacity: Number(e.currentTarget.value) })} />
          </label>
          <label className="wallpaper-field"><span>{t("背景适配方式")}</span>
            <select className="select-input" value={value.codexAppImageOverlayFitMode}
              onChange={e => onChange({ codexAppImageOverlayFitMode: e.currentTarget.value as WallpaperValues["codexAppImageOverlayFitMode"] })}>
              <option value="fill">{t("填充")}</option><option value="fit">{t("适应")}</option>
              <option value="stretch">{t("拉伸")}</option><option value="tile" disabled={source?.kind !== "image"}>{t("平铺")}</option>
              <option value="center">{t("居中")}</option>
            </select>
          </label>
        </div>
        <div className="toolbar">
          <label className="inline-toggle"><input type="checkbox" checked={value.codexAppWallpaperMuted}
            disabled={source?.kind === "web"} onChange={e => onChange({ codexAppWallpaperMuted: e.currentTarget.checked })} /><span>{t("静音播放")}</span></label>
          <Button variant="secondary" disabled={!source || !["video", "scene"].includes(source.kind)}
            onClick={() => onChange({ codexAppWallpaperPaused: !value.codexAppWallpaperPaused })}>
            {value.codexAppWallpaperPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {value.codexAppWallpaperPaused ? t("继续播放") : t("暂停视频")}
          </Button>
        </div>
      </div>
    </div>
    {source?.kind === "scene" ? <div className="wallpaper-engine">
      <p>{t("原生 Scene 需要 Windows 和已安装的 Wallpaper Engine；仅捕获独立渲染窗口，不修改桌面壁纸。")}</p>
      <div className="toolbar">
        <Input aria-label={t("Wallpaper Engine 程序路径")} placeholder={t("自动从 Steam 壁纸目录查找，也可手动选择")}
          value={value.codexAppWallpaperEnginePath} onChange={e => onChange({ codexAppWallpaperEnginePath: e.currentTarget.value })} />
        <Button variant="secondary" disabled={busy} onClick={() => void chooseEngine()}>{t("选择程序")}</Button>
      </div>
    </div> : null}
    {source?.kind === "web" ? <p className="wallpaper-note">{t("Web 项目使用隔离沙箱；仅加载项目内资源，不允许外部网络、应用启动或访问 Codex，依赖这些能力的项目可能无法完整运行。")}</p> : null}
    <p className="wallpaper-note">{t("视频不超过 2 GiB；优先使用 MP4（H.264）或 WebM。PNG 保持原图，APNG、GIF、动画 WebP 保留动画。")}</p>
    <p className="wallpaper-note">{t("保存后，下次通过 Alunixa X 启动 Codex 时生效；预览始终静音。")}</p>
    {message ? <p className="wallpaper-message" role="status">{message}</p> : null}
    <div className="toolbar">
      <Button disabled={busy} onClick={() => void action(onSave)}>{busy ? t("处理中…") : t("保存设置")}</Button>
      <Button disabled={busy} variant="secondary" onClick={() => void action(onReset)}>{t("重置背景")}</Button>
      <Button disabled={busy} variant="outline" onClick={() => void action(async () => {
        const changed = await invoke<boolean>("repair_codex_feature_config");
        setMessage(changed ? t("配置已备份并修复，请重新打开报错的任务。") : t("未发现无效的 guardianv2 配置，无需修改。"));
      })}><Wrench className="h-4 w-4" />{t("修复对话配置")}</Button>
    </div>
  </section>;
}
