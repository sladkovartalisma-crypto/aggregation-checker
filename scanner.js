class CameraScanner {
    constructor(readerId, hintId, onScanCallback) {
        this.readerId = readerId;
        this.hintId = hintId;
        this.onScanCallback = onScanCallback;
        this.html5QrCode = null;
        this.isScanning = false;
        this.currentCamera = 'environment';
        this.scanAreaSize = 300;
        this.lastScannedCode = null;
        this.lastScanTime = 0;
        this.scanCooldown = 1000;
    }

    async start() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Камера не поддерживается в этом браузере');
            }

            if (typeof Html5Qrcode === 'undefined') {
                throw new Error('Библиотека сканирования не загружена');
            }

            if (this.html5QrCode && this.isScanning) {
                await this.stop();
            }

            this.html5QrCode = new Html5Qrcode(this.readerId);

            const readerElement = document.getElementById(this.readerId);
            if (!readerElement) {
                throw new Error('Элемент сканера не найден');
            }
            
            const viewportWidth = readerElement.offsetWidth;
            const viewportHeight = readerElement.offsetHeight;
            const maxSize = Math.min(viewportWidth, viewportHeight) * 0.8;
            this.scanAreaSize = Math.min(400, maxSize);

            const config = {
                fps: 10,
                qrbox: {
                    width: this.scanAreaSize,
                    height: this.scanAreaSize
                },
                aspectRatio: 1.0,
                disableFlip: false,
                formatsToSupport: this.getAllSupportedFormats(),
                videoConstraints: {
                    facingMode: this.currentCamera,
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 15 }
                }
            };

            console.log(`Запуск сканера ${this.readerId}...`);

            await this.html5QrCode.start(
                { 
                    facingMode: this.currentCamera,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                config,
                this.onScanSuccess.bind(this),
                this.onScanError.bind(this)
            );

            this.isScanning = true;
            this.updateUIState(true);
            this.updateScannerFrame();
            
            app.showNotification('Сканер запущен', 'success');
            
        } catch (error) {
            console.error('Ошибка запуска сканера:', error);
            
            if (this.html5QrCode) {
                try {
                    await this.html5QrCode.stop();
                } catch (e) {
                    console.warn('Ошибка при остановке сканера:', e);
                }
                this.html5QrCode = null;
            }
            
            this.isScanning = false;
            this.updateUIState(false);
            
            let errorMessage = 'Не удалось запустить сканер. ';
            
            if (error.name === 'NotAllowedError' || error.message.includes('разрешите')) {
                errorMessage += 'Разрешите доступ к камере в настройках браузера.';
            } else if (error.name === 'NotFoundError') {
                errorMessage += 'Камера не найдена.';
            } else if (error.name === 'NotSupportedError') {
                errorMessage += 'Ваш браузер не поддерживает эту функцию.';
            } else if (error.message.includes('библиотека')) {
                errorMessage += 'Проблема с загрузкой библиотеки сканирования.';
            } else {
                errorMessage += error.message || 'Неизвестная ошибка.';
            }
            
            app.showNotification(errorMessage, 'error');
        }
    }

    getAllSupportedFormats() {
        if (typeof Html5QrcodeSupportedFormats === 'undefined') {
            return [];
        }
        
        return [
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.PDF_417,
            Html5QrcodeSupportedFormats.AZTEC,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF
        ];
    }

    async stop() {
        if (this.html5QrCode && this.isScanning) {
            try {
                await this.html5QrCode.stop();
            } catch (error) {
                console.error('Ошибка остановки сканера:', error);
            }
        }
        
        this.isScanning = false;
        this.html5QrCode = null;
        this.updateUIState(false);
    }

    updateUIState(isScanning) {
        const startBtn = document.getElementById(`startScanner${this.readerId.replace('reader', '')}`);
        const stopBtn = document.getElementById(`stopScanner${this.readerId.replace('reader', '')}`);
        
        if (startBtn) startBtn.style.display = isScanning ? 'none' : 'flex';
        if (stopBtn) stopBtn.style.display = isScanning ? 'flex' : 'none';
        
        const hint = document.getElementById(this.hintId);
        if (hint) {
            hint.textContent = isScanning ? 
                'Наведите камеру на штрих-код или Data Matrix' : 
                'Нажмите "Запустить сканер"';
        }
    }

    onScanSuccess(decodedText) {
        if (!this.isScanning) return;
        
        const now = Date.now();
        if (decodedText === this.lastScannedCode && (now - this.lastScanTime) < this.scanCooldown) {
            return;
        }
        
        console.log(`Распознан код в ${this.readerId}:`, decodedText);
        
        this.lastScannedCode = decodedText;
        this.lastScanTime = now;
        
        // Отображаем код в поле ручного ввода для контроля
        const manualInput = document.getElementById(`manualInput${this.readerId.replace('reader', '')}`);
        if (manualInput) {
            manualInput.value = decodedText;
        }
        
        // Визуальная обратная связь
        this.showScanSuccess();
        
        // Вызываем callback-функцию
        if (this.onScanCallback) {
            this.onScanCallback(decodedText);
        }
        
        // Краткая пауза перед следующим сканированием
        this.pauseScanner(500);
    }

    onScanError(error) {
        // Игнорируем обычные ошибки "код не найден"
        if (!error || error.message?.includes('NotFoundException')) {
            return;
        }
        
        console.debug('Ошибка сканирования:', error);
    }

    pauseScanner(duration) {
        if (this.isScanning) {
            this.isScanning = false;
            
            setTimeout(() => {
                this.isScanning = true;
                this.lastScannedCode = null;
            }, duration);
        }
    }

    showScanSuccess() {
        const frame = document.querySelector(`#${this.readerId} .scanner-frame`);
        const overlay = document.querySelector(`#${this.readerId} .scanner-overlay`);
        
        if (frame) {
            frame.style.borderColor = '#4CAF50';
            frame.style.boxShadow = '0 0 30px rgba(76, 175, 80, 0.7)';
            
            if (overlay) {
                overlay.innerHTML = '<p style="color: #4CAF50; font-weight: bold;">✓ Распознано!</p>';
            }
            
            setTimeout(() => {
                frame.style.borderColor = 'white';
                frame.style.boxShadow = 'none';
                
                if (overlay) {
                    overlay.innerHTML = '<p>Наведите камеру на штрих-код</p>';
                }
            }, 800);
        }
    }

    updateScannerFrame() {
        const frame = document.querySelector(`#${this.readerId} .scanner-frame`);
        if (frame) {
            frame.style.width = this.scanAreaSize + 'px';
            frame.style.height = this.scanAreaSize + 'px';
        }
    }
}

// Создаем два сканера: для проверки и для сборки
const cameraScannerCheck = new CameraScanner('readerCheck', 'scannerHintCheck', (code) => {
    app.processScan(code);
});

const cameraScannerAssembly = new CameraScanner('readerAssembly', 'scannerHintAssembly', (code) => {
    app.processAssemblyScan(code);
});

// Экспортируем функции
window.cameraScannerCheck = cameraScannerCheck;
window.cameraScannerAssembly = cameraScannerAssembly;
window.startScannerCheck = startScannerCheck;
window.stopScannerCheck = stopScannerCheck;
window.startScannerAssembly = startScannerAssembly;
window.stopScannerAssembly = stopScannerAssembly;
window.handleManualInputCheck = handleManualInputCheck;
window.handleManualInputAssembly = handleManualInputAssembly;
window.processManualInputCheck = processManualInputCheck;
window.processManualInputAssembly = processManualInputAssembly;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    // Проверяем поддержку камеры
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        app.showNotification('Ваш браузер не поддерживает камеру. Используйте ручной ввод.', 'warning');
    }
});

// Обработчик изменения размера окна
window.addEventListener('resize', () => {
    if (cameraScannerCheck.isScanning) {
        cameraScannerCheck.updateScannerFrame();
    }
    if (cameraScannerAssembly.isScanning) {
        cameraScannerAssembly.updateScannerFrame();
    }
});