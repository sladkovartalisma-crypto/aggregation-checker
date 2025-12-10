class AggregationChecker {
    constructor() {
        this.data = {
            pallets: new Map(),
            boxes: new Map(),
            kms: new Map()
        };
        
        this.currentState = {
            pallet: null,
            box: null,
            scannedItems: []
        };
        
        this.checkHistory = {
            checks: [],
            currentCheck: null,
            lastFile: null
        };
        
        this.currentFile = null;
        this.processing = false;
        
        this.init();
    }

    init() {
        this.loadFromStorage();
        this.loadCheckHistory();
        this.setupEventListeners();
        this.updateUI();
        this.updateReportUI();
        
        // Автосохранение каждые 30 секунд
        setInterval(() => this.autoSave(), 30000);
    }

    // Функция нормализации кодов - удаление спецсимволов
    normalizeCode(code) {
        if (!code) return '';
        // Удаляем все спецсимвола GS1 (коды 29, 30, 31) и другие непечатаемые символы
        return code.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    }

    setupEventListeners() {
        // Загрузка файла
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                this.handleFileSelect(e.target.files[0]);
            });
        }

        // Drag and drop
        const dropArea = document.getElementById('dropArea');
        if (dropArea) {
            dropArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropArea.classList.add('dragover');
            });

            dropArea.addEventListener('dragleave', () => {
                dropArea.classList.remove('dragover');
            });

            dropArea.addEventListener('drop', (e) => {
                e.preventDefault();
                dropArea.classList.remove('dragover');
                if (e.dataTransfer.files[0]) {
                    this.handleFileSelect(e.dataTransfer.files[0]);
                }
            });
        }

        // Кнопка обработки файла
        const processBtn = document.getElementById('processBtn');
        if (processBtn) {
            processBtn.addEventListener('click', () => this.processUploadedFile());
        }
    }

    async handleFileSelect(file) {
        if (!file || !file.name.match(/\.(csv|txt)$/i)) {
            this.showNotification('Выберите CSV или TXT файл', 'error');
            return;
        }

        this.currentFile = file;
        document.getElementById('fileName').textContent = `Выбран файл: ${file.name}`;
        
        const processBtn = document.getElementById('processBtn');
        if (processBtn) {
            processBtn.disabled = false;
        }
        
        try {
            const preview = await this.previewFile(file);
            this.updatePreviewUI(preview);
        } catch (error) {
            this.showNotification('Ошибка предпросмотра файла', 'error');
        }
    }

    async previewFile(file, maxRows = 10) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const text = e.target.result;
                    const lines = text.split(/\r\n|\n/);
                    const previewRows = [];
                    
                    for (let i = 0; i < Math.min(lines.length, maxRows); i++) {
                        const row = this.parseCSVRow(lines[i]);
                        if (row) {
                            previewRows.push(row);
                        }
                    }
                    
                    resolve(previewRows);
                } catch (error) {
                    reject(error);
                }
            };
            
            reader.onerror = reject;
            reader.readAsText(file, 'UTF-8');
        });
    }

    updatePreviewUI(previewRows) {
        const tableBody = document.getElementById('dataPreview')?.querySelector('tbody');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        previewRows.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td title="${row.km}">${this.truncateText(row.km, 15)}</td>
                <td>${row.box || ''}</td>
                <td>${row.pallet || ''}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    async processUploadedFile() {
        if (!this.currentFile || this.processing) {
            return;
        }

        try {
            this.processing = true;
            this.showNotification('Начинаем обработку файла...', 'info');
            
            // Сохраняем предыдущую проверку перед очисткой
            if (this.currentState.pallet || this.currentState.scannedItems.length > 0) {
                this.saveCheckCompletion();
            }
            
            // Очищаем старые данные
            this.clearData();
            
            // Обрабатываем весь файл
            const processed = await this.processWholeFile(this.currentFile);
            
            // Сохраняем информацию о файле
            this.checkHistory.lastFile = {
                name: this.currentFile.name,
                size: this.currentFile.size,
                date: new Date().toISOString(),
                processedLines: processed
            };
            
            this.saveToStorage();
            this.saveCheckHistory();
            this.updateUI();
            this.updateReportUI();
            
            this.showNotification(
                `Данные загружены: ${this.getStats().pallets} паллет, ${this.getStats().boxes} коробов, ${this.getStats().kms} КМ`, 
                'success'
            );
            
            // Автоматически переключаемся на вкладку отчета
            setTimeout(() => showSection('report'), 500);
            
        } catch (error) {
            console.error('Ошибка обработки файла:', error);
            this.showNotification('Ошибка обработки файла: ' + error.message, 'error');
        } finally {
            this.processing = false;
        }
    }

    async processWholeFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const text = e.target.result;
                    const lines = text.split(/\r\n|\n/);
                    let processed = 0;
                    let skipped = 0;
                    
                    console.log(`Всего строк в файле: ${lines.length}`);
                    
                    const processBatch = (startIndex) => {
                        const endIndex = Math.min(startIndex + 1000, lines.length);
                        
                        for (let i = startIndex; i < endIndex; i++) {
                            const line = lines[i];
                            if (line.trim()) {
                                const row = this.parseCSVRow(line);
                                if (row) {
                                    this.processRow(row);
                                    processed++;
                                    memoryOptimizer.incrementLinesProcessed();
                                } else {
                                    skipped++;
                                }
                            }
                        }
                        
                        // Обновляем статистику каждые 1000 строк
                        if (processed % 1000 === 0) {
                            this.updateStatsUI();
                        }
                        
                        if (endIndex < lines.length) {
                            setTimeout(() => processBatch(endIndex), 0);
                        } else {
                            console.log(`Обработка завершена. Обработано: ${processed}, Пропущено: ${skipped}`);
                            resolve(processed);
                        }
                    };
                    
                    processBatch(0);
                    
                } catch (error) {
                    reject(error);
                }
            };
            
            reader.onerror = reject;
            reader.readAsText(file, 'UTF-8');
        });
    }

    parseCSVRow(line) {
        line = line.replace(/\r$/, '').trim();
        if (!line) return null;
        
        const parts = line.split('\t');
        if (parts.length < 3) {
            return null;
        }
        
        // Нормализация кодов при чтении из файла
        return {
            km: this.normalizeCode(parts[0].trim()),
            box: this.normalizeCode(parts[1].trim()),
            pallet: this.normalizeCode(parts[2].trim()),
            productionDate: parts[3] ? parts[3].trim() : '',
            expiryDate: parts[4] ? parts[4].trim() : ''
        };
    }

    processRow(row) {
        const { km, box, pallet } = row;
        
        if (!km || !box || !pallet) {
            return;
        }
        
        // Паллета
        if (!this.data.pallets.has(pallet)) {
            this.data.pallets.set(pallet, {
                boxes: new Set(),
                kms: new Set()
            });
        }
        
        // Короб
        if (!this.data.boxes.has(box)) {
            this.data.boxes.set(box, {
                pallet: pallet,
                kms: new Set()
            });
        }
        
        // КМ - проверка на дубликаты
        if (this.data.kms.has(km)) {
            return;
        }
        
        this.data.kms.set(km, {
            box: box,
            pallet: pallet
        });
        
        // Связи
        const palletData = this.data.pallets.get(pallet);
        palletData.boxes.add(box);
        palletData.kms.add(km);
        
        const boxData = this.data.boxes.get(box);
        boxData.kms.add(km);
    }

    getStats() {
        return {
            pallets: this.data.pallets.size,
            boxes: this.data.boxes.size,
            kms: this.data.kms.size
        };
    }

    updateStatsUI() {
        const stats = this.getStats();
        const elements = [
            'dataPallets', 'dataBoxes', 'dataKMs'
        ];
        
        elements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = stats[id.replace('data', '').toLowerCase()] || 0;
            }
        });
        
        const dataDate = document.getElementById('dataDate');
        if (dataDate) {
            dataDate.textContent = this.getDataDate();
        }
    }

    clearData() {
        this.data.pallets.clear();
        this.data.boxes.clear();
        this.data.kms.clear();
        this.currentState = {
            pallet: null,
            box: null,
            scannedItems: []
        };
        this.updateCheckUI();
        this.saveCurrentState();
    }

    processScan(code) {
        if (!code?.trim()) return;
        
        // Нормализация сканированного кода
        code = this.normalizeCode(code.trim());
        console.log('Сканирование в проверке (нормализовано):', code);
        
        // Проверяем, является ли код паллетой
        if (this.data.pallets.has(code)) {
            this.handlePalletScan(code);
            return;
        }
        
        // Проверяем, является ли код коробом
        if (this.data.boxes.has(code)) {
            this.handleBoxScan(code);
            return;
        }
        
        // Проверяем, является ли код товаром
        if (this.data.kms.has(code)) {
            this.handleItemScan(code);
            return;
        }
        
        this.showNotification('Код не найден в данных', 'error');
    }

    handlePalletScan(code) {
        // Всегда устанавливаем новую паллету, независимо от текущего состояния
        this.currentState.pallet = code;
        this.currentState.box = null;
        this.currentState.scannedItems = [];
        
        this.showNotification(`Установлена паллета: ${code}`, 'success');
        document.getElementById('scannerHintCheck').textContent = 'Отсканируйте короб для этой паллеты';
        this.updateCheckUI();
        this.saveCurrentState();
    }

    handleBoxScan(code) {
        const boxData = this.data.boxes.get(code);
        
        if (!boxData) {
            this.showNotification('Короб не найден', 'error');
            return;
        }
        
        // Если нет текущей паллеты, устанавливаем ее из короба
        if (!this.currentState.pallet) {
            this.currentState.pallet = boxData.pallet;
            this.currentState.box = code;
            this.currentState.scannedItems = [];
            this.showNotification(`Установлены паллета ${boxData.pallet} и короб ${code}`, 'success');
            document.getElementById('scannerHintCheck').textContent = 'Отсканируйте товары для этого короба';
        }
        // Если есть текущая паллета, проверяем принадлежность
        else if (boxData.pallet === this.currentState.pallet) {
            // Если это тот же короб, что и текущий - ВЫХОДИМ из короба
            if (this.currentState.box === code) {
                this.currentState.box = null;  // Выходим из короба
                this.currentState.scannedItems = [];
                this.showNotification('Вышли из короба. Отсканируйте другой короб этой паллеты.', 'info');
                document.getElementById('scannerHintCheck').textContent = 'Отсканируйте любой короб для текущей паллеты';
            }
            // Если другой короб той же паллеты
            else {
                this.currentState.box = code;
                this.currentState.scannedItems = [];
                this.showNotification(`Переключен на короб: ${code}`, 'success');
                document.getElementById('scannerHintCheck').textContent = 'Отсканируйте товары для этого короба';
            }
        }
        // Короб не принадлежит текущей паллете
        else {
            this.showNotification(`Короб ${code} принадлежит другой паллете (${boxData.pallet})`, 'error');
            return;
        }
        
        this.updateCheckUI();
        this.saveCurrentState();
    }

    handleItemScan(code) {
        const itemData = this.data.kms.get(code);
        
        if (!itemData) {
            this.showNotification('Товар не найден', 'error');
            return;
        }
        
        // Проверяем, есть ли текущая паллета и короб
        if (!this.currentState.pallet) {
            this.showNotification('Сначала отсканируйте паллету', 'warning');
            return;
        }
        
        if (!this.currentState.box) {
            this.showNotification('Сначала отсканируйте короб', 'warning');
            return;
        }
        
        // Проверяем принадлежность товара
        if (itemData.pallet !== this.currentState.pallet || itemData.box !== this.currentState.box) {
            this.showNotification(`Товар принадлежит другой паллете/коробу`, 'error');
            return;
        }
        
        // Проверяем, не был ли уже отсканирован этот товар
        if (this.currentState.scannedItems.includes(code)) {
            this.showNotification('Этот товар уже отсканирован', 'warning');
            return;
        }
        
        // Добавляем товар в список
        this.currentState.scannedItems.push(code);
        this.showNotification(`Товар ${this.truncateText(code, 10)} добавлен (${this.currentState.scannedItems.length} шт.)`, 'success');
        
        // Обновляем интерфейс
        this.updateCheckUI();
        
        // Обновляем подсказку
        document.getElementById('scannerHintCheck').textContent = 'Сканируйте товары или отсканируйте тот же короб для выхода';
        
        this.saveCurrentState();
    }

    updateCheckUI() {
        // Обновляем состояние
        const currentPallet = document.getElementById('currentPallet');
        const currentBox = document.getElementById('currentBox');
        const scannedItemsCount = document.getElementById('scannedItemsCount');
        const checkStatus = document.getElementById('checkStatus');
        
        if (currentPallet) currentPallet.textContent = this.currentState.pallet || 'Не отсканирована';
        
        if (currentBox) {
            if (this.currentState.pallet) {
                currentBox.textContent = this.currentState.box || 'Не выбран (ожидание короба)';
            } else {
                currentBox.textContent = 'Не отсканирован';
            }
        }
        
        if (scannedItemsCount) scannedItemsCount.textContent = this.currentState.scannedItems.length;
        
        // Обновляем статус в заголовке
        let statusText = 'Ожидание сканирования';
        if (this.currentState.pallet && !this.currentState.box) {
            statusText = 'Ожидание короба для паллеты';
        } else if (this.currentState.pallet && this.currentState.box) {
            statusText = `Сканирование товаров в коробе`;
        }
        if (checkStatus) checkStatus.textContent = statusText;
        
        // Обновляем список отсканированных товаров
        const itemsList = document.getElementById('scannedItemsList');
        if (itemsList) {
            itemsList.innerHTML = '';
            
            if (this.currentState.scannedItems.length === 0) {
                itemsList.innerHTML = '<p class="empty-message">Товары еще не отсканированы</p>';
            } else {
                this.currentState.scannedItems.forEach((item, index) => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'item';
                    itemDiv.innerHTML = `
                        <span>${index + 1}. ${item}</span>
                        <button onclick="app.removeScannedItem('${item}')" class="btn-small">✕</button>
                    `;
                    itemsList.appendChild(itemDiv);
                });
            }
        }
    }

    removeScannedItem(code) {
        // Код уже нормализован при добавлении, поэтому не нормализуем снова
        const index = this.currentState.scannedItems.indexOf(code);
        if (index > -1) {
            this.currentState.scannedItems.splice(index, 1);
            this.updateCheckUI();
            this.showNotification('Товар удален из списка', 'info');
            this.saveCurrentState();
        }
    }

    resetCheck() {
        // Сохраняем текущую проверку перед сбросом
        this.saveCheckCompletion();
        
        this.currentState = {
            pallet: null,
            box: null,
            scannedItems: []
        };
        
        this.showNotification('Проверка полностью сброшена', 'info');
        document.getElementById('scannerHintCheck').textContent = 'Отсканируйте паллету';
        this.updateCheckUI();
        this.saveCurrentState();
    }

    // Функционал для сборки
    processAssemblyScan(code) {
        if (!code?.trim()) return;
        
        // Нормализация сканированного кода
        code = this.normalizeCode(code.trim());
        const assemblyInfo = document.getElementById('assemblyInfo');
        
        if (!assemblyInfo) return;
        
        let infoHTML = '';
        
        // Проверяем тип кода и выводим соответствующую информацию
        if (this.data.pallets.has(code)) {
            const palletData = this.data.pallets.get(code);
            const boxes = Array.from(palletData.boxes);
            
            infoHTML = `
                <div class="assembly-result">
                    <h3>📦 Паллета: ${code}</h3>
                    <div class="info-section">
                        <p><strong>Количество коробов:</strong> <span class="badge">${palletData.boxes.size}</span></p>
                        <p><strong>Количество товаров:</strong> <span class="badge">${palletData.kms.size}</span></p>
                    </div>
                    ${boxes.length > 0 ? `
                        <div class="boxes-list">
                            <h4>Короба в паллете:</h4>
                            ${boxes.map(box => {
                                const boxData = this.data.boxes.get(box);
                                return `
                                    <div class="box-item">
                                        <span>${box}</span>
                                        <span class="small-text">${boxData.kms.size} товаров</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : '<p class="empty-message">В паллете нет коробов</p>'}
                </div>
            `;
        }
        else if (this.data.boxes.has(code)) {
            const boxData = this.data.boxes.get(code);
            
            infoHTML = `
                <div class="assembly-result">
                    <h3>📁 Короб: ${code}</h3>
                    <div class="info-section">
                        <p><strong>Принадлежит паллете:</strong> <span class="badge">${boxData.pallet}</span></p>
                        <p><strong>Количество товаров:</strong> <span class="badge">${boxData.kms.size}</span></p>
                    </div>
                </div>
            `;
        }
        else if (this.data.kms.has(code)) {
            const kmData = this.data.kms.get(code);
            
            infoHTML = `
                <div class="assembly-result">
                    <h3>🏷️ Товар: ${this.truncateText(code, 20)}</h3>
                    <div class="info-section">
                        <p><strong>Находится в коробе:</strong> <span class="badge">${kmData.box}</span></p>
                        <p><strong>Находится в паллете:</strong> <span class="badge">${kmData.pallet}</span></p>
                    </div>
                </div>
            `;
        }
        else {
            infoHTML = `
                <div class="assembly-result">
                    <h3>❌ Код не найден</h3>
                    <div class="info-section">
                        <p>Код <strong>${code}</strong> не найден в загруженных данных.</p>
                        <p>Загрузите данные CSV файла во вкладке "Данные".</p>
                    </div>
                </div>
            `;
        }
        
        assemblyInfo.innerHTML = infoHTML;
        this.showNotification('Информация обновлена', 'success');
    }

    updateUI() {
        this.updateStatsUI();
        this.updateCheckUI();
    }

    // === АВТОСОХРАНЕНИЕ СОСТОЯНИЯ ===
    saveCurrentState() {
        try {
            localStorage.setItem('aggregationCurrentState', JSON.stringify(this.currentState));
            localStorage.setItem('aggregationStateTimestamp', new Date().toISOString());
        } catch (e) {
            console.warn('Не удалось сохранить текущее состояние:', e);
        }
    }

    loadCurrentState() {
        try {
            const savedState = localStorage.getItem('aggregationCurrentState');
            if (savedState) {
                const state = JSON.parse(savedState);
                // Проверяем, что состояние еще актуально (данные существуют)
                if (state.pallet && !this.data.pallets.has(state.pallet)) {
                    return; // Паллета больше не существует в данных
                }
                if (state.box && !this.data.boxes.has(state.box)) {
                    state.box = null;
                    state.scannedItems = [];
                }
                // Фильтруем отсканированные товары, которые больше не существуют
                if (state.scannedItems && state.scannedItems.length > 0) {
                    state.scannedItems = state.scannedItems.filter(item => 
                        this.data.kms.has(item)
                    );
                }
                this.currentState = state;
            }
        } catch (e) {
            console.warn('Не удалось загрузить текущее состояние:', e);
        }
    }

    autoSave() {
        if (this.currentState.pallet || this.currentState.scannedItems.length > 0) {
            this.saveCurrentState();
            console.log('Автосохранение состояния выполнено');
        }
    }

    // === ИСТОРИЯ ПРОВЕРОК И ОТЧЕТЫ ===
    saveCheckCompletion() {
        if (!this.currentState.pallet && this.currentState.scannedItems.length === 0) {
            return;
        }

        const check = {
            id: Date.now(),
            date: new Date().toISOString(),
            state: { ...this.currentState },
            fileInfo: this.checkHistory.lastFile,
            dataStats: this.getStats(),
            scannedSummary: {
                totalItems: this.currentState.scannedItems.length,
                pallets: this.currentState.pallet ? 1 : 0,
                boxes: this.currentState.box ? 1 : 0
            }
        };

        this.checkHistory.currentCheck = check;
        this.checkHistory.checks.unshift(check);
        
        // Ограничиваем историю последними 50 проверками
        if (this.checkHistory.checks.length > 50) {
            this.checkHistory.checks = this.checkHistory.checks.slice(0, 50);
        }

        this.saveCheckHistory();
    }

    saveCheckHistory() {
        try {
            localStorage.setItem('aggregationCheckHistory', JSON.stringify(this.checkHistory));
        } catch (e) {
            console.warn('Не удалось сохранить историю проверок:', e);
        }
    }

    loadCheckHistory() {
        try {
            const savedHistory = localStorage.getItem('aggregationCheckHistory');
            if (savedHistory) {
                this.checkHistory = JSON.parse(savedHistory);
                this.loadCurrentState();
            }
        } catch (e) {
            console.warn('Не удалось загрузить историю проверок:', e);
        }
    }

    updateReportUI() {
        const reportContent = document.getElementById('reportContent');
        if (!reportContent) return;

        let html = '';
        
        // Последняя проверка
        if (this.checkHistory.currentCheck) {
            const check = this.checkHistory.currentCheck;
            const date = new Date(check.date).toLocaleString();
            
            html += `
                <div class="report-section">
                    <h3>📋 Последняя проверка</h3>
                    <div class="report-card">
                        <div class="report-row">
                            <span class="report-label">Дата проверки:</span>
                            <span class="report-value">${date}</span>
                        </div>
                        ${check.fileInfo ? `
                            <div class="report-row">
                                <span class="report-label">Файл данных:</span>
                                <span class="report-value">${check.fileInfo.name}</span>
                            </div>
                            <div class="report-row">
                                <span class="report-label">Обработано строк:</span>
                                <span class="report-value">${check.fileInfo.processedLines}</span>
                            </div>
                        ` : ''}
                        <div class="report-row">
                            <span class="report-label">Проверено паллет:</span>
                            <span class="report-value">${check.scannedSummary.pallets}</span>
                        </div>
                        <div class="report-row">
                            <span class="report-label">Проверено коробов:</span>
                            <span class="report-value">${check.scannedSummary.boxes}</span>
                        </div>
                        <div class="report-row">
                            <span class="report-label">Проверено товаров:</span>
                            <span class="report-value">${check.scannedSummary.totalItems}</span>
                        </div>
                        ${check.state.pallet ? `
                            <div class="report-row">
                                <span class="report-label">Текущая паллета:</span>
                                <span class="report-value">${check.state.pallet}</span>
                            </div>
                        ` : ''}
                        ${check.state.box ? `
                            <div class="report-row">
                                <span class="report-label">Текущий короб:</span>
                                <span class="report-value">${check.state.box}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="report-section">
                    <h3>📋 Последняя проверка</h3>
                    <div class="empty-message">
                        <p>Проверки еще не проводились</p>
                        <p class="small-text">Начните проверку во вкладке "Проверка"</p>
                    </div>
                </div>
            `;
        }

        // Статистика данных
        const stats = this.getStats();
        html += `
            <div class="report-section">
                <h3>📊 Статистика данных</h3>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">📦</div>
                        <div class="stat-value">${stats.pallets}</div>
                        <div class="stat-label">Паллет</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">📁</div>
                        <div class="stat-value">${stats.boxes}</div>
                        <div class="stat-label">Коробов</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">🏷️</div>
                        <div class="stat-value">${stats.kms}</div>
                        <div class="stat-label">Товаров</div>
                    </div>
                </div>
            </div>
        `;

        // История проверок
        if (this.checkHistory.checks.length > 0) {
            html += `
                <div class="report-section">
                    <h3>🕐 История проверок (последние 10)</h3>
                    <div class="history-table-container">
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th>Дата</th>
                                    <th>Паллет</th>
                                    <th>Коробов</th>
                                    <th>Товаров</th>
                                    <th>Файл</th>
                                </tr>
                            </thead>
                            <tbody>
            `;

            this.checkHistory.checks.slice(0, 10).forEach(check => {
                const date = new Date(check.date).toLocaleDateString('ru-RU');
                const fileName = check.fileInfo ? check.fileInfo.name.substring(0, 15) + (check.fileInfo.name.length > 15 ? '...' : '') : 'Нет файла';
                
                html += `
                    <tr>
                        <td>${date}</td>
                        <td>${check.scannedSummary.pallets}</td>
                        <td>${check.scannedSummary.boxes}</td>
                        <td>${check.scannedSummary.totalItems}</td>
                        <td title="${check.fileInfo ? check.fileInfo.name : ''}">${fileName}</td>
                    </tr>
                `;
            });

            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        reportContent.innerHTML = html;
    }

    generateReport() {
        if (!this.checkHistory.lastFile) {
            this.showNotification('Нет данных для формирования отчета', 'warning');
            return;
        }

        const fileName = this.checkHistory.lastFile.name;
        const baseName = fileName.replace(/\.[^/.]+$/, ""); // Удаляем расширение
        const reportDate = new Date().toISOString().split('T')[0];
        const reportFileName = `отчет_${baseName}_${reportDate}.txt`;

        let reportContent = `ОТЧЕТ О ПРОВЕРКЕ АГРЕГАЦИИ ТОВАРОВ\n`;
        reportContent += `========================================\n\n`;
        reportContent += `Дата формирования: ${new Date().toLocaleString('ru-RU')}\n`;
        reportContent += `Имя файла данных: ${fileName}\n`;
        reportContent += `Дата обработки файла: ${new Date(this.checkHistory.lastFile.date).toLocaleString('ru-RU')}\n`;
        reportContent += `Обработано строк: ${this.checkHistory.lastFile.processedLines}\n\n`;

        const stats = this.getStats();
        reportContent += `СТАТИСТИКА ДАННЫХ:\n`;
        reportContent += `Паллет: ${stats.pallets}\n`;
        reportContent += `Коробов: ${stats.boxes}\n`;
        reportContent += `Товаров (КМ): ${stats.kms}\n\n`;

        if (this.checkHistory.currentCheck) {
            const check = this.checkHistory.currentCheck;
            reportContent += `ПОСЛЕДНЯЯ ПРОВЕРКА:\n`;
            reportContent += `Дата проверки: ${new Date(check.date).toLocaleString('ru-RU')}\n`;
            reportContent += `Проверено паллет: ${check.scannedSummary.pallets}\n`;
            reportContent += `Проверено коробов: ${check.scannedSummary.boxes}\n`;
            reportContent += `Проверено товаров: ${check.scannedSummary.totalItems}\n\n`;

            if (check.state.pallet) {
                reportContent += `Текущая паллета: ${check.state.pallet}\n`;
            }
            if (check.state.box) {
                reportContent += `Текущий короб: ${check.state.box}\n`;
            }
            if (check.state.scannedItems.length > 0) {
                reportContent += `\nОТСКАНИРОВАННЫЕ ТОВАРЫ (${check.state.scannedItems.length} шт.):\n`;
                check.state.scannedItems.forEach((item, index) => {
                    reportContent += `${index + 1}. ${item}\n`;
                });
            }
        }

        reportContent += `\n========================================\n`;
        reportContent += `Сформировано в системе проверки агрегации\n`;

        // Создаем и скачиваем файл
        const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = reportFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        this.showNotification(`Отчет сохранен как ${reportFileName}`, 'success');
    }

    saveToStorage() {
        try {
            const dataToSave = {
                pallets: Array.from(this.data.pallets.entries()).map(([key, value]) => [
                    key,
                    {
                        boxes: Array.from(value.boxes),
                        kms: Array.from(value.kms)
                    }
                ]),
                boxes: Array.from(this.data.boxes.entries()).map(([key, value]) => [
                    key,
                    {
                        pallet: value.pallet,
                        kms: Array.from(value.kms)
                    }
                ]),
                kms: Array.from(this.data.kms.entries())
            };
            
            localStorage.setItem('aggregationData', JSON.stringify(dataToSave));
            localStorage.setItem('aggregationDate', new Date().toISOString());
        } catch (e) {
            console.warn('Не удалось сохранить данные:', e);
            this.showNotification('Не удалось сохранить данные в хранилище', 'error');
        }
    }

    loadFromStorage() {
        try {
            const savedData = localStorage.getItem('aggregationData');
            if (savedData) {
                const parsedData = JSON.parse(savedData);
                
                this.data.pallets = new Map(
                    parsedData.pallets?.map(([key, value]) => [
                        key,
                        {
                            boxes: new Set(value.boxes || []),
                            kms: new Set(value.kms || [])
                        }
                    ]) || []
                );
                
                this.data.boxes = new Map(
                    parsedData.boxes?.map(([key, value]) => [
                        key,
                        {
                            pallet: value.pallet,
                            kms: new Set(value.kms || [])
                        }
                    ]) || []
                );
                
                this.data.kms = new Map(parsedData.kms || []);
            }
        } catch (e) {
            console.warn('Не удалось загрузить данные:', e);
        }
    }

    getDataDate() {
        const date = localStorage.getItem('aggregationDate');
        return date ? new Date(date).toLocaleString() : 'Не загружено';
    }

    clearAllData() {
        if (confirm('Вы уверены, что хотите удалить все данные?')) {
            this.clearData();
            localStorage.removeItem('aggregationData');
            localStorage.removeItem('aggregationDate');
            localStorage.removeItem('aggregationCurrentState');
            localStorage.removeItem('aggregationCheckHistory');
            this.saveToStorage();
            this.updateUI();
            this.showNotification('Данные очищены', 'success');
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        if (!notification) return;
        
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.style.display = 'block';
        
        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    }

    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text || '';
        return text.substring(0, maxLength) + '...';
    }
}

// Глобальные функции
const app = new AggregationChecker();

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const targetSection = document.getElementById(`${sectionId}-section`);
    if (targetSection) {
        targetSection.classList.add('active');
    }
    
    // Активируем кнопку навигации
    const activeBtn = Array.from(document.querySelectorAll('.nav-btn')).find(btn => {
        const span = btn.querySelector('span');
        if (!span) return false;
        
        return span.textContent.includes(
            sectionId === 'check' ? 'Проверка' :
            sectionId === 'data' ? 'Данные' :
            sectionId === 'assembly' ? 'Сборка' :
            sectionId === 'report' ? 'Отчет' : ''
        );
    });
    
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    // Обновляем отчет при открытии вкладки
    if (sectionId === 'report') {
        app.updateReportUI();
    }
}

function startScannerCheck() {
    if (window.cameraScannerCheck) {
        cameraScannerCheck.start();
    }
}

function stopScannerCheck() {
    if (window.cameraScannerCheck) {
        cameraScannerCheck.stop();
    }
}

function handleManualInputCheck(event) {
    if (event.key === 'Enter') {
        processManualInputCheck();
    }
}

function processManualInputCheck() {
    const input = document.getElementById('manualInputCheck');
    if (input?.value) {
        const normalizedCode = app.normalizeCode(input.value);
        app.processScan(normalizedCode);
        input.value = '';
    }
}

function startScannerAssembly() {
    if (window.cameraScannerAssembly) {
        cameraScannerAssembly.start();
    }
}

function stopScannerAssembly() {
    if (window.cameraScannerAssembly) {
        cameraScannerAssembly.stop();
    }
}

function handleManualInputAssembly(event) {
    if (event.key === 'Enter') {
        processManualInputAssembly();
    }
}

function processManualInputAssembly() {
    const input = document.getElementById('manualInputAssembly');
    if (input?.value) {
        const normalizedCode = app.normalizeCode(input.value);
        app.processAssemblyScan(normalizedCode);
        input.value = '';
    }
}

function resetCheck() {
    app.resetCheck();
}

function processUploadedFile() {
    app.processUploadedFile();
}

function clearAllData() {
    app.clearAllData();
}

function clearManualInput(inputId) {
    const input = document.getElementById(inputId);
    if (input) {
        input.value = '';
    }
}

function generateReport() {
    app.generateReport();
}

function clearHistory() {
    if (confirm('Вы уверены, что хотите очистить историю проверок?')) {
        app.checkHistory = {
            checks: [],
            currentCheck: null,
            lastFile: null
        };
        app.saveCheckHistory();
        app.updateReportUI();
        app.showNotification('История проверок очищена', 'success');
    }
}

// Инициализация при загрузке
window.addEventListener('load', () => {
    showSection('check');
});

// Глобальный экспорт
window.app = app;