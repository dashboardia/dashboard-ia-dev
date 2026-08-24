"use client";

import { FileText, LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { useEffect, useRef } from "react";

import styles from "./chat-composer.module.css";

export default function ChatComposer({
  id,
  label,
  value,
  onChange,
  onPaste,
  onSubmit,
  placeholder,
  maxLength = 12000,
  loading = false,
  disabled = false,
  canSubmit = Boolean(value?.trim()),
  submitLabel = "Enviar",
  loadingLabel = "Enviando…",
  controls,
  attachments = [],
  renderAttachment,
  onRemoveAttachment,
  fileInputRef,
  accept,
  onFilesSelected,
  attachmentDisabled = false,
  attachmentHint,
  error,
  footer,
  compact = false,
  className = "",
}) {
  const formRef = useRef(null);
  const textareaRef = useRef(null);
  const supportsAttachments = Boolean(onFilesSelected);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, compact ? 156 : 260)}px`;
  }, [compact, value]);

  function handleKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!disabled && !loading && canSubmit) formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} className={`${styles.form} ${compact ? styles.compact : ""} ${className}`} onSubmit={onSubmit}>
      <div className={styles.shell}>
        {attachments.length > 0 && (
          <div className={styles.attachments}>
            {attachments.map((attachment, index) => (
              <div className={styles.attachment} key={attachment.key ?? `${attachment.name ?? "arquivo"}-${index}`}>
                <div className={styles.attachmentPreview}>
                  {renderAttachment ? renderAttachment(attachment, index) : <FileText size={20} />}
                </div>
                <span title={attachment.name}>{attachment.name}</span>
                {onRemoveAttachment && (
                  <button type="button" onClick={() => onRemoveAttachment(index)} aria-label={`Remover ${attachment.name ?? "arquivo"}`}>
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <label className={styles.srOnly} htmlFor={id}>{label}</label>
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={onChange}
          onPaste={onPaste}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={1}
          disabled={disabled}
        />
        <div className={styles.toolbar}>
          <div className={styles.toolbarStart}>
            {supportsAttachments && (
              <>
                <input ref={fileInputRef} hidden type="file" accept={accept} multiple onChange={onFilesSelected} />
                <button className={styles.attachButton} type="button" onClick={() => fileInputRef.current?.click()} disabled={loading || disabled || attachmentDisabled} aria-label="Anexar arquivos" title="Anexar arquivos">
                  <Paperclip size={17} />
                </button>
              </>
            )}
            {controls && <div className={styles.controls}>{controls}</div>}
          </div>
          {attachmentHint && <span className={styles.hint}>{attachmentHint}</span>}
          <button className={styles.sendButton} type="submit" disabled={disabled || loading || !canSubmit} aria-label={loading ? loadingLabel : submitLabel} title={loading ? loadingLabel : `${submitLabel} · Enter`}>
            {loading ? <LoaderCircle className="spin" size={18} /> : <Send size={17} />}
          </button>
        </div>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {footer && <div className={styles.footer}>{footer}</div>}
    </form>
  );
}
