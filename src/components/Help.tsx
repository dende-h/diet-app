import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * カードの見出しの横に置く「？」ボタン。押すと説明をモーダルで開く。
 * モーダルはカードの外（body 直下）に出して、カードやフォームのスタイル・送信の影響を受けないようにする。
 */
export function HelpButton({ title, children }: { title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = () => dialog.current?.close()

  return (
    <>
      <button type="button" className="help-button" aria-label={`${title}の説明`} onClick={() => dialog.current?.showModal()}>
        ?
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="help-dialog"
          aria-label={title}
          // 外側（暗い部分）を押しても閉じる
          onClick={(e) => {
            if (e.target === dialog.current) close()
          }}
        >
          <div className="help-body">
            {/* 開いたときは最初のボタンにフォーカスが移るので、閉じるボタンを先頭に置いて上から表示されるようにする */}
            <div className="help-header">
              <h2>{title}</h2>
              <button type="button" className="icon-button small" aria-label="閉じる" onClick={close}>
                ×
              </button>
            </div>
            {children}
            <button type="button" className="button wide" onClick={close}>
              閉じる
            </button>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}

/** 見出しの文字と「？」を並べる */
export function TitleWithHelp({ title, help, children }: { title: ReactNode; help: string; children: ReactNode }) {
  return (
    <span className="title-with-help">
      {title}
      <HelpButton title={help}>{children}</HelpButton>
    </span>
  )
}
