export class ZoomConfig {
    private zFactor: number = 1.1

    constructor() {
    }

    increaseZoomFactor(factor: number): void {
        this.zFactor < 1.1 ? this.zFactor += 0.01 : this.zFactor < 1.2 ? this.zFactor += 0.1 : this.zFactor += 0.5
    }

    decreaseZoomFactor(factor: number): void {
        this.zFactor > 1.2 ? this.zFactor -= 0.5 : this.zFactor > 1.1 ? this.zFactor -= 0.1 : this.zFactor -= 0.01
    }
}