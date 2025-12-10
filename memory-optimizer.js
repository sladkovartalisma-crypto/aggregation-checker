class MemoryOptimizer {
    constructor() {
        this.memoryCheckInterval = null;
        this.lastCleanup = Date.now();
        this.maxLinesBeforeCleanup = 50000;
        this.linesProcessed = 0;
    }

    startMonitoring() {
        this.memoryCheckInterval = setInterval(() => {
            this.checkMemoryUsage();
        }, 30000);
    }

    stopMonitoring() {
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
            this.memoryCheckInterval = null;
        }
    }

    checkMemoryUsage() {
        if (performance.memory) {
            const usedMB = performance.memory.usedJSHeapSize / (1024 * 1024);
            const totalMB = performance.memory.totalJSHeapSize / (1024 * 1024);
            const ratio = usedMB / totalMB;
            
            console.log(`Использование памяти: ${usedMB.toFixed(2)}MB / ${totalMB.toFixed(2)}MB (${(ratio * 100).toFixed(1)}%)`);
            
            if (ratio > 0.85) {
                this.cleanupMemory();
            }
        }
        
        if (this.linesProcessed > this.maxLinesBeforeCleanup) {
            this.intermediateCleanup();
            this.linesProcessed = 0;
        }
    }

    cleanupMemory() {
        const now = Date.now();
        if (now - this.lastCleanup < 30000) return;
        
        console.log('Запуск очистки памяти...');
        
        if (window.gc) {
            window.gc();
        }
        
        this.optimizeDataStructures();
        
        this.lastCleanup = now;
        console.log('Очистка памяти завершена');
    }

    intermediateCleanup() {
        console.log('Промежуточная очистка после обработки', this.linesProcessed, 'строк');
        
        if (window.app && app.data) {
            app.data.pallets.forEach((palletData, key) => {
                if (palletData.kms) {
                    palletData.kms = new Set(Array.from(palletData.kms).slice(-10000));
                }
            });
        }
        
        if (window.gc) {
            setTimeout(() => window.gc(), 100);
        }
    }

    optimizeDataStructures() {
        if (!window.app || !app.data) return;
        
        console.log('Оптимизация структур данных...');
        
        let totalKMs = 0;
        let totalBoxes = 0;
        
        app.data.pallets.forEach((palletData, key) => {
            totalKMs += palletData.kms?.size || 0;
            totalBoxes += palletData.boxes?.size || 0;
        });
        
        console.log(`Всего КМ в паллетах: ${totalKMs}, коробов: ${totalBoxes}`);
        
        if (totalKMs > 50000) {
            app.data.pallets.forEach((palletData, key) => {
                if (palletData.kms.size > 10000) {
                    const kmsArray = Array.from(palletData.kms);
                    palletData.kms = new Set(kmsArray.slice(-10000));
                }
            });
        }
    }

    incrementLinesProcessed(count = 1) {
        this.linesProcessed += count;
    }

    resetCounter() {
        this.linesProcessed = 0;
    }
}

// Глобальный экземпляр оптимизатора
const memoryOptimizer = new MemoryOptimizer();

// Запускаем мониторинг при загрузке страницы
window.addEventListener('load', () => {
    memoryOptimizer.startMonitoring();
});

// Останавливаем при закрытии страницы
window.addEventListener('beforeunload', () => {
    memoryOptimizer.stopMonitoring();
});