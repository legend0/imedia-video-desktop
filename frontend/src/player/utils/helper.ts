export interface PlayUrlItem {
  title: string;
  url: string;
  type: 'm3u8' | 'mp4' | 'iframe' | 'live';
}

export interface PlayUrlResult {
  m3u8: PlayUrlItem[];
  mp4: PlayUrlItem[];
  iframe: PlayUrlItem[];
  live: PlayUrlItem[];
}

function determineUrlType(url: string): 'm3u8' | 'mp4' | 'iframe' {
  if (!url) return 'iframe';

  const cleanUrl = url.toLowerCase().split('?')[0];

  if (cleanUrl.includes('.m3u8') || cleanUrl.includes('.m3u')) {
    return 'm3u8';
  }

  if (cleanUrl.includes('.mp4') || cleanUrl.includes('.webm') ||
      cleanUrl.includes('.avi') || cleanUrl.includes('.mov') ||
      cleanUrl.includes('.mkv') || cleanUrl.includes('.flv')) {
    return 'mp4';
  }

  if (cleanUrl.includes('rtmp://') || cleanUrl.includes('rtsp://')) {
    return 'mp4';
  }

  return 'iframe';
}

export function parsePlayUrl(playUrl: string, type = ''): PlayUrlResult | Partial<PlayUrlResult> {
  try {
    if (!playUrl || typeof playUrl !== 'string') {
      return { m3u8: [], mp4: [], iframe: [], live: [] };
    }

    playUrl = playUrl.replace(/[<>`]/g, '');

    const firstLevel = playUrl.includes('$$$') ? playUrl.split('$$$') : [playUrl];

    const secondLevel = firstLevel.map(part =>
      part.includes('#') ? part.split('#') : [part]
    );

    const result: PlayUrlResult = { m3u8: [], mp4: [], iframe: [], live: [] };

    secondLevel.forEach(parts => {
      parts.forEach(part => {
        const splitPart = part.includes('$') ? part.split('$') : [part, '', ''];
        const title = splitPart[0]?.trim() || '';
        const url = splitPart[1]?.trim() || '';

        if (title && url) {
          const urlType = determineUrlType(url);
          const item: PlayUrlItem = { title, url, type: urlType };

          if (urlType === 'm3u8' || urlType === 'mp4') {
            result[urlType].push(item);
          } else {
            result.iframe.push(item);
          }
        }
      });
    });

    if (type) {
      const validTypes: Array<keyof PlayUrlResult> = ['m3u8', 'mp4', 'iframe', 'live'];
      if (validTypes.includes(type as keyof PlayUrlResult)) {
        return { [type]: result[type as keyof PlayUrlResult] };
      }
      return {};
    }

    return result;
  } catch (error) {
    return { m3u8: [], mp4: [], iframe: [], live: [] };
  }
}

export function captureVideoFrame(
  videoElement: HTMLVideoElement,
  options: { width?: number; height?: number; format?: string; quality?: number } = {}
): string {
  try {
    if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
      throw new Error('无效的视频元素');
    }

    if (videoElement.readyState < 2) {
      throw new Error('视频未准备好');
    }

    const config = {
      width: options.width || videoElement.videoWidth || 320,
      height: options.height || videoElement.videoHeight || 240,
      format: options.format || 'jpeg',
      quality: options.quality || 0.8
    };

    const canvas = document.createElement('canvas');
    canvas.width = config.width;
    canvas.height = config.height;

    const ctx = canvas.getContext('2d');
    ctx!.drawImage(videoElement, 0, 0, config.width, config.height);

    return canvas.toDataURL(`image/${config.format}`, config.quality);
  } catch (error) {
    throw error;
  }
}

export interface ModalOptions {
  title?: string;
  content?: string;
  type?: string;
  showClose?: boolean;
  closable?: boolean;
  width?: string;
  height?: string;
  buttons?: Array<{ text: string; type?: string; callback?: (data?: unknown) => void }>;
  onOpen?: () => void;
  onClose?: () => void;
  backdrop?: boolean;
  form?: {
    fields: Array<{
      type?: string;
      name?: string;
      label?: string;
      placeholder?: string;
      value?: string | boolean;
      required?: boolean;
      rows?: number;
      options?: Array<{ value: string; label: string; tip?: string }>;
      checked?: boolean;
      html?: string;
      tip?: string;
    }>;
    onSubmit?: (data: Record<string, unknown>) => void;
  };
}

export class Modal {
  options: ModalOptions;
  isOpen: boolean;
  modalElement: HTMLElement | null;
  backdropElement: HTMLElement | null;

  constructor(options: ModalOptions = {}) {
    this.options = {
      title: '提示',
      content: '',
      type: 'info',
      showClose: true,
      closable: true,
      width: '400px',
      height: 'auto',
      buttons: [],
      onOpen: null,
      onClose: null,
      backdrop: true,
      form: null,
      ...options
    };

    this.isOpen = false;
    this.modalElement = null;
    this.backdropElement = null;

    this._createModal();
    this._bindEvents();
  }

  _createModal(): void {
    if (this.options.backdrop) {
      this.backdropElement = document.createElement('div');
      this.backdropElement.className = 'modal-backdrop';
    }

    this.modalElement = document.createElement('div');
    this.modalElement.className = `modal modal-type-${this.options.type}`;
    this.modalElement.style.width = this.options.width || '400px';
    this.modalElement.style.height = this.options.height || 'auto';

    const headerHtml = `<div class="modal-header">
        <h3 class="modal-title">${this.options.title}</h3>
        ${this.options.showClose ? '<button class="modal-close-btn" type="button">×</button>' : ''}
    </div>`;

    let bodyHtml = `<div class="modal-body">
        <div class="modal-content">${this.options.content}</div>`;

    if (this.options.form) {
      let formHtml = '<div class="modal-form">';
      this.options.form.fields.forEach(field => {
        if (field.type === 'custom') {
          formHtml += field.html || '';
          return;
        }

        formHtml += `<div class="form-group">
            <label for="${field.name}">${field.label || ''}${field.required ? '<span class="required-mark">*</span>' : ''}</label>`;

        formHtml += '<div class="input-wrapper">';

        switch (field.type) {
          case 'textarea':
            formHtml += `<textarea id="${field.name}" name="${field.name}" 
                class="form-input" 
                placeholder="${field.placeholder || ''}" 
                ${field.required ? 'required' : ''}
                ${field.rows ? 'rows="' + field.rows + '"' : ''}>${field.value || ''}</textarea>`;
            break;
          case 'select':
            formHtml += `<select id="${field.name}" name="${field.name}" class="form-input" ${field.required ? 'required' : ''}>
                <option value="">${field.placeholder || '请选择选项'}</option>`;
            (field.options || []).forEach(option => {
              formHtml += `<option value="${option.value}" ${field.value === option.value ? 'selected' : ''}>${option.label}</option>`;
            });
            formHtml += '</select>';
            break;
          case 'radio':
            formHtml += '<div class="radio-group">';
            (field.options || []).forEach((option, index) => {
              const isChecked = field.value === option.value || (index === 0 && !field.value);
              formHtml += `<label class="radio-label">
                  <input type="radio" name="${field.name}" value="${option.value}" ${isChecked ? 'checked' : ''}>
                  <span class="radio-text">${option.label}</span>`;
              if (option.tip) {
                formHtml += `<span class="radio-tip">${option.tip}</span>`;
              }
              formHtml += '</label>';
            });
            formHtml += '</div>';
            break;
          case 'checkbox':
            formHtml += `<label class="checkbox-label">
                <input type="checkbox" name="${field.name}" value="${field.value || 'true'}" ${field.checked ? 'checked' : ''}>
                <span class="checkbox-text">${field.label || ''}</span>`;
            if (field.tip) {
              formHtml += `<span class="checkbox-tip">${field.tip}</span>`;
            }
            formHtml += '</label>';
            break;
          case 'switch':
            formHtml += `<label class="switch-label">
                <input type="checkbox" class="switch-input" name="${field.name}" value="${field.value || 'true'}" ${field.checked ? 'checked' : ''}>
                <span class="switch-text">${field.label || ''}</span>`;
            if (field.tip) {
              formHtml += `<span class="switch-tip">${field.tip}</span>`;
            }
            formHtml += '</label>';
            break;
          default:
            formHtml += `<input type="${field.type || 'text'}" 
                id="${field.name}" 
                name="${field.name}" 
                class="form-input"
                placeholder="${field.placeholder || ''}" 
                value="${field.value || ''}" 
                ${field.required ? 'required' : ''}>`;
        }

        if (field.tip && field.type !== 'checkbox' && field.type !== 'switch' && field.type !== 'radio') {
          formHtml += `<div class="form-tip">${field.tip}</div>`;
        }

        formHtml += '</div>';
        formHtml += '</div>';
      });
      formHtml += '</div>';
      bodyHtml += formHtml;
    }
    bodyHtml += '</div>';

    let footerHtml = '<div class="modal-footer">';
    if (this.options.buttons.length > 0) {
      this.options.buttons.forEach((btn, idx) => {
        let btnClass = 'form-btn';
        switch (btn.type) {
          case 'primary':
            btnClass += ' btn-primary';
            break;
          case 'secondary':
            btnClass += ' btn-secondary';
            break;
          case 'success':
            btnClass += ' btn-success';
            break;
          case 'warning':
            btnClass += ' btn-warning';
            break;
          case 'error':
          case 'danger':
            btnClass += ' btn-error';
            break;
          case 'ghost':
            btnClass += ' btn-ghost';
            break;
          default:
            btnClass += ' btn-secondary';
        }
        footerHtml += `<button class="${btnClass}" data-index="${idx}" type="button">${btn.text}</button>`;
      });
    } else {
      if (this.options.type === 'confirm' || this.options.form) {
        footerHtml += '<button class="form-btn btn-secondary" data-action="cancel" type="button">取消</button>';
      }
      footerHtml += '<button class="form-btn btn-primary" data-action="submit" type="button">确定</button>';
    }
    footerHtml += '</div>';

    this.modalElement.innerHTML = headerHtml + bodyHtml + footerHtml;
  }

  _bindEvents(): void {
    const closeBtn = this.modalElement!.querySelector('.modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    this.modalElement!.querySelectorAll('.form-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = (e.target as HTMLElement).dataset.action;
        const idx = (e.target as HTMLElement).dataset.index;

        if (action === 'cancel') {
          this.close();
          const cancelButton = this.options.buttons?.find(b => b.type === 'default') ||
            this.options.buttons?.find(b => b.text?.includes('取消'));
          cancelButton?.callback?.(null);
        } else if (action === 'submit' || (idx !== undefined && this.options.buttons[parseInt(idx)]?.type === 'primary')) {
          const isSubmitButton = action === 'submit' ||
            (idx !== undefined && this.options.buttons[parseInt(idx)]?.type === 'primary');

          if (isSubmitButton) {
            if (this.options.form) {
              const isValid = this._validateForm();
              if (!isValid) {
                return;
              }

              const formData = this._getFormData();
              this.close();

              if (this.options.form.onSubmit) {
                this.options.form.onSubmit(formData);
              } else if (idx !== undefined) {
                const btnConfig = this.options.buttons[parseInt(idx)];
                btnConfig?.callback?.(formData);
              } else {
                const okButton = this.options.buttons?.find(b => b.type === 'primary') ||
                  this.options.buttons?.find(b => b.text?.includes('确定'));
                okButton?.callback?.(formData);
              }
            } else {
              this.close();
              if (idx !== undefined) {
                const btnConfig = this.options.buttons[parseInt(idx)];
                btnConfig?.callback?.(this);
              } else {
                const okButton = this.options.buttons?.find(b => b.type === 'primary') ||
                  this.options.buttons?.find(b => b.text?.includes('确定'));
                okButton?.callback?.(this);
              }
            }
          }
        } else if (idx !== undefined) {
          const btnConfig = this.options.buttons[parseInt(idx)];
          btnConfig?.callback?.(this) || this.close();
        }
      });
    });

    if (this.options.closable && this.backdropElement) {
      this.backdropElement.addEventListener('click', (e) => {
        if (e.target === this.backdropElement) this.close();
      });
    }

    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  _validateForm(): boolean {
    if (!this.options.form) return true;

    const inputs = this.modalElement!.querySelectorAll('.modal-form input, .modal-form textarea, .modal-form select');
    let isValid = true;

    inputs.forEach(input => {
      input.style.borderColor = '';
      const errorMsg = input.parentNode?.querySelector('.form-error');
      if (errorMsg) errorMsg.remove();
    });

    inputs.forEach(input => {
      let isEmpty = false;

      if (input.type === 'checkbox' || input.type === 'radio') {
        if (input.hasAttribute('required') && !input.checked) {
          isEmpty = true;
        }
      } else {
        if (input.hasAttribute('required') && !input.value.trim()) {
          isEmpty = true;
        }
      }

      if (isEmpty) {
        isValid = false;
        input.classList.add('input-error');

        const errorMsg = document.createElement('div');
        errorMsg.className = 'form-message error-message';
        errorMsg.textContent = '此项为必填项';

        const parent = input.parentNode;
        if (parent?.querySelector('.form-message')) {
          parent.querySelector('.form-message')!.remove();
        }
        parent?.appendChild(errorMsg);

        const removeError = () => {
          input.classList.remove('input-error');
          const existingError = input.parentNode?.querySelector('.form-message');
          if (existingError) existingError.remove();
          input.removeEventListener('input', removeError);
          input.removeEventListener('change', removeError);
        };
        input.addEventListener('input', removeError);
        input.addEventListener('change', removeError);
      }
    });

    if (!isValid) {
      this.modalElement!.style.animation = 'none';
      setTimeout(() => {
        this.modalElement!.style.animation = 'shake 0.5s ease-in-out';
      }, 10);
      setTimeout(() => {
        this.modalElement!.style.animation = '';
      }, 600);
    }

    return isValid;
  }

  _getFormData(): Record<string, unknown> {
    const formData: Record<string, unknown> = {};
    if (this.options.form) {
      this.modalElement!.querySelectorAll('.modal-form input, .modal-form textarea, .modal-form select').forEach(el => {
        if (el.type === 'checkbox') {
          formData[el.name] = el.checked;
        } else if (el.type === 'radio') {
          if (el.checked) formData[el.name] = el.value;
        } else {
          formData[el.name] = el.value.trim();
        }
      });
    }
    return formData;
  }

  open(): void {
    if (this.isOpen) return;
    if (this.backdropElement) document.body.appendChild(this.backdropElement);
    document.body.appendChild(this.modalElement!);
    setTimeout(() => {
      this.modalElement!.classList.add('modal-show');
      this.backdropElement?.classList.add('modal-backdrop-show');
    }, 10);
    this.isOpen = true;
    this.options.onOpen && this.options.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.modalElement!.classList.remove('modal-show');
    this.backdropElement?.classList.remove('modal-backdrop-show');
    setTimeout(() => {
      this.modalElement!.parentNode?.removeChild(this.modalElement!);
      this.backdropElement?.parentNode?.removeChild(this.backdropElement);
    }, 300);
    this.isOpen = false;
    this.options.onClose && this.options.onClose();
  }

  setContent(content: string): void {
    const el = this.modalElement?.querySelector('.modal-content');
    if (el) el.innerHTML = content;
  }

  setTitle(title: string): void {
    const el = this.modalElement?.querySelector('.modal-title');
    if (el) el.textContent = title;
  }
}

export function showModalConfirm(options: {
  title?: string;
  content?: string;
  confirmText?: string;
  cancelText?: string;
  closable?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal({
      title: options.title || '确认操作',
      content: options.content || '确定要执行此操作吗？',
      type: 'confirm',
      buttons: [
        {
          text: options.cancelText || '取消',
          type: 'default',
          callback: () => resolve(false)
        },
        {
          text: options.confirmText || '确定',
          type: 'primary',
          callback: () => resolve(true)
        }
      ],
      showClose: false,
      closable: options.closable ?? false
    });
    modal.open();
  });
}