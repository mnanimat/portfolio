"use client";

import { upload } from "@vercel/blob/client";
import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ClipItem = {
  id: string;
  file: File;
  url: string;
};

type UploadResult = {
  id: string;
  key: string;
  name: string;
  size: number;
  url: string;
};

const MAX_FILES = 8;
const MAX_TOTAL = 90 * 1024 * 1024;
const MAX_FILE = 90 * 1024 * 1024;

const styles = [
  { id: "cyber", label: "Cyber pulse", detail: "Neon, glitches e ritmo alto" },
  { id: "cinema", label: "Cinematic", detail: "Cor, respiro e narrativa" },
  { id: "clean", label: "Clean motion", detail: "Tipografia e produto em foco" },
  { id: "anime", label: "Impact frames", detail: "Velocidade, traços e energia" },
];

const formats = [
  "9:16 · Reels / Shorts",
  "16:9 · YouTube",
  "1:1 · Feed",
  "21:9 · Cinemático",
];

function bytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function QuoteStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const clipsRef = useRef<ClipItem[]>([]);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [style, setStyle] = useState("cyber");
  const [format, setFormat] = useState(formats[0]);
  const [duration, setDuration] = useState("30–45 segundos");
  const [deadline, setDeadline] = useState("7–10 dias");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [accent, setAccent] = useState("Ciano + magenta");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploads, setUploads] = useState<UploadResult[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  useEffect(
    () => () =>
      clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url)),
    [],
  );

  const totalSize = useMemo(
    () => clips.reduce((sum, clip) => sum + clip.file.size, 0),
    [clips],
  );

  const addFiles = (incoming: File[]) => {
    setStatus("");

    const videos = incoming.filter((file) => file.type.startsWith("video/"));
    if (videos.length !== incoming.length) {
      setStatus("Arquivos que não são vídeo foram ignorados.");
    }

    const oversized = videos.find((file) => file.size > MAX_FILE);
    if (oversized) {
      setStatus(`O arquivo ${oversized.name} ultrapassa 90 MB.`);
      return;
    }

    setClips((current) => {
      const remaining = Math.max(0, MAX_FILES - current.length);
      const additions = videos.slice(0, remaining).map((file) => ({
        id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        url: URL.createObjectURL(file),
      }));

      const next = [...current, ...additions];
      const nextTotal = next.reduce((sum, clip) => sum + clip.file.size, 0);

      if (nextTotal > MAX_TOTAL) {
        additions.forEach((clip) => URL.revokeObjectURL(clip.url));
        setStatus("O conjunto ultrapassa 90 MB. Remova ou compacte um clipe.");
        return current;
      }

      if (videos.length > remaining) {
        setStatus(`Limite de ${MAX_FILES} clipes por briefing.`);
      }

      setUploads([]);
      setUploadProgress(0);
      return next;
    });
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const removeClip = (id: string) => {
    setClips((current) => {
      const removed = current.find((clip) => clip.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((clip) => clip.id !== id);
    });

    setUploads([]);
    setUploadProgress(0);
  };

  const moveClip = (index: number, direction: -1 | 1) => {
    setClips((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;

      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const uploadClips = async () => {
    if (!clips.length || uploading) return;

    setUploading(true);
    setUploads([]);
    setUploadProgress(0);
    setStatus("Preparando envio seguro…");

    try {
      const completed: UploadResult[] = [];

      for (let index = 0; index < clips.length; index += 1) {
        const clip = clips[index];

        setStatus(`Enviando ${index + 1} de ${clips.length}: ${clip.file.name}`);

        const blob = await upload(clip.file.name, clip.file, {
          access: "public",
          handleUploadUrl: "/api/uploads",
          multipart: clip.file.size > 5 * 1024 * 1024,
          clientPayload: JSON.stringify({
            source: "portfolio-video-request",
          }),
          onUploadProgress: ({ percentage }) => {
            const totalPercentage =
              ((index + percentage / 100) / clips.length) * 100;
            setUploadProgress(Math.round(totalPercentage));
          },
        });

        completed.push({
          id: crypto.randomUUID(),
          key: blob.pathname,
          name: clip.file.name,
          size: clip.file.size,
          url: blob.url,
        });

        setUploads([...completed]);
      }

      setUploadProgress(100);
      setStatus(`${completed.length} clipe(s) anexado(s) ao briefing.`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Falha ao enviar. Você ainda pode usar o WhatsApp.",
      );
    } finally {
      setUploading(false);
    }
  };

  const brief = useMemo(() => {
    const styleName =
      styles.find((item) => item.id === style)?.label ?? style;

    const files = clips
      .map(
        (clip, index) =>
          `${index + 1}. ${clip.file.name} (${bytes(clip.file.size)})`,
      )
      .join("\n");

    const uploadLinks = uploads.length
      ? `\nAnexos enviados:\n${uploads
          .map((item, index) => `${index + 1}. ${item.url}`)
          .join("\n")}`
      : "";

    return [
      "Olá, MN Animation! Quero solicitar um orçamento de edição.",
      name ? `Nome: ${name}` : "",
      `Estilo: ${styleName}`,
      `Formato: ${format}`,
      `Duração: ${duration}`,
      `Prazo desejado: ${deadline}`,
      `Paleta: ${accent}`,
      notes ? `Briefing: ${notes}` : "",
      files
        ? `Clipes selecionados:\n${files}${uploadLinks}`
        : "Clipes: vou enviar na conversa",
    ]
      .filter(Boolean)
      .join("\n");
  }, [accent, clips, deadline, duration, format, name, notes, style, uploads]);

  const whatsappUrl = `https://wa.me/5575982321124?text=${encodeURIComponent(
    brief,
  )}`;

  const emailUrl = `mailto:mnanimat@gmail.com?subject=${encodeURIComponent(
    "Orçamento de edição de vídeo",
  )}&body=${encodeURIComponent(brief)}`;

  return (
    <div className="quote-studio">
      <div className="quote-builder">
        <div className="builder-step">
          <span className="step-number">01</span>
          <div>
            <h3>Escolha a linguagem</h3>
            <p>Defina a energia visual; o briefing continua totalmente ajustável.</p>
          </div>
        </div>

        <div className="style-grid" role="radiogroup" aria-label="Estilo de edição">
          {styles.map((item) => (
            <button
              type="button"
              role="radio"
              aria-checked={style === item.id}
              className={`style-card ${style === item.id ? "is-selected" : ""}`}
              key={item.id}
              onClick={() => setStyle(item.id)}
            >
              <span className={`style-card__swatch style-card__swatch--${item.id}`} />
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
        </div>

        <div className="builder-step builder-step--spaced">
          <span className="step-number">02</span>
          <div>
            <h3>Monte o briefing</h3>
            <p>Formato, ritmo, cor e entrega em uma visão só.</p>
          </div>
        </div>

        <div className="brief-grid">
          <label>
            Formato
            <select value={format} onChange={(event) => setFormat(event.target.value)}>
              {formats.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>

          <label>
            Duração
            <select value={duration} onChange={(event) => setDuration(event.target.value)}>
              <option>15 segundos</option>
              <option>30–45 segundos</option>
              <option>60–90 segundos</option>
              <option>Acima de 2 minutos</option>
            </select>
          </label>

          <label>
            Prazo
            <select value={deadline} onChange={(event) => setDeadline(event.target.value)}>
              <option>3–5 dias</option>
              <option>7–10 dias</option>
              <option>2–3 semanas</option>
              <option>Sem urgência</option>
            </select>
          </label>

          <label>
            Paleta
            <select value={accent} onChange={(event) => setAccent(event.target.value)}>
              <option>Ciano + magenta</option>
              <option>Verde ácido + preto</option>
              <option>Quente cinematográfica</option>
              <option>Usar cores da marca</option>
            </select>
          </label>

          <label className="brief-grid__wide">
            Seu nome
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Como podemos chamar você?"
            />
          </label>

          <label className="brief-grid__wide">
            Direção criativa
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Conte a história, referências, música, textos obrigatórios e onde o vídeo será publicado…"
            />
          </label>
        </div>
      </div>

      <aside className="clip-workspace">
        <div className="builder-step">
          <span className="step-number">03</span>
          <div>
            <h3>Anexe e ordene</h3>
            <p>Prévia local antes de qualquer envio.</p>
          </div>
        </div>

        <div
          className={`drop-zone ${dragging ? "is-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={onInput}
            hidden
          />
          <span className="drop-zone__icon">＋</span>
          <strong>Solte seus clipes aqui</strong>
          <small>Até 8 arquivos e 90 MB no total</small>
          <button
            type="button"
            className="secondary-button"
            onClick={() => inputRef.current?.click()}
          >
            Escolher clipes
          </button>
        </div>

        {clips.length > 0 && (
          <div className="clip-list" aria-label="Clipes do briefing">
            {clips.map((clip, index) => (
              <article className="clip-item" key={clip.id}>
                <video
                  src={clip.url}
                  muted
                  preload="metadata"
                  aria-label={`Prévia de ${clip.file.name}`}
                />
                <div className="clip-item__body">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{clip.file.name}</strong>
                    <small>{bytes(clip.file.size)}</small>
                  </div>
                </div>
                <div className="clip-item__actions">
                  <button
                    type="button"
                    onClick={() => moveClip(index, -1)}
                    disabled={index === 0}
                    aria-label={`Mover ${clip.file.name} para cima`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveClip(index, 1)}
                    disabled={index === clips.length - 1}
                    aria-label={`Mover ${clip.file.name} para baixo`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeClip(clip.id)}
                    aria-label={`Remover ${clip.file.name}`}
                  >
                    ×
                  </button>
                </div>
              </article>
            ))}

            <div className="clip-list__summary">
              <span>{clips.length}/{MAX_FILES} clipes</span>
              <span>{bytes(totalSize)} / 90 MB</span>
            </div>

            {uploading && (
              <div aria-label={`Upload ${uploadProgress}%`}>
                <progress value={uploadProgress} max={100} />
                <small>{uploadProgress}%</small>
              </div>
            )}

            <button
              className="secondary-button secondary-button--full"
              type="button"
              onClick={uploadClips}
              disabled={uploading}
            >
              {uploading
                ? "Enviando…"
                : uploads.length
                  ? "Reenviar anexos"
                  : "Anexar clipes ao briefing"}
            </button>
          </div>
        )}

        {status && <p className="upload-status" role="status">{status}</p>}

        <div className="quote-actions">
          <a
            className="whatsapp-button"
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
          >
            <span>Solicitar no WhatsApp</span>
            <small>(75) 98232-1124 ↗</small>
          </a>
          <a className="email-button" href={emailUrl}>
            <span>Enviar por e-mail</span>
            <small>mnanimat@gmail.com</small>
          </a>
        </div>

        <p className="privacy-note">
          Os arquivos só são enviados quando você toca em “Anexar”. Após o
          envio, o briefing inclui os links dos arquivos armazenados no Vercel Blob.
        </p>
      </aside>
    </div>
  );
}
