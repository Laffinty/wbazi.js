/**
 * Wbazi.js - 一个现代、高精度的八字排盘JavaScript库。
 * 本库使用天文算法计算节气，而非依赖固定的查找表，以确保高精度。
 * 它被设计为单文件、模块化的结构。
 */
(function(root, factory) {
    // 兼容各种模块化环境 (AMD, CommonJS, and browser globals)
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Wbazi = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    // --- 内部私有作用域：核心模块 ---

    // 模块：基础常量和数据
    const _constants = {
        TIAN_GAN: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
        DI_ZHI: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],
        JIAZI: [], // 将由 _ganzhiModule 初始化
        // 24节气的太阳黄经度数
        SOLAR_TERM_ANGLES: [
            315, 330, 345, 0, 15, 30, 45, 60, 75, 90, 105, 120,
            135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300
        ],
        // 日柱计算的纪元：1900年1月1日 00:00 UTC 是 甲戌日。
        // 甲为0 (0-indexed), 戌为10 (0-indexed)。
        // 纪元的儒略日数：2415020.5
        // 甲戌的干支索引是 10。
        EPOCH_JD: 2415020.5,
        EPOCH_DAY_GANZHI_INDEX: 10,
        FIVE_ELEMENTS_GAN: {
            '甲': '木', '乙': '木',
            '丙': '火', '丁': '火',
            '戊': '土', '己': '土',
            '庚': '金', '辛': '金',
            '壬': '水', '癸': '水'
        },
        HIDDEN_GANS: {
            '子': ['癸'],
            '丑': ['己', '癸', '辛'],
            '寅': ['甲', '丙', '戊'],
            '卯': ['乙'],
            '辰': ['戊', '乙', '癸'],
            '巳': ['丙', '庚', '戊'],
            '午': ['丁', '己'],
            '未': ['己', '丁', '乙'],
            '申': ['庚', '壬', '戊'],
            '酉': ['辛'],
            '戌': ['戊', '辛', '丁'],
            '亥': ['壬', '甲']
        },
        WUXING_RELATIONS: {
            '生': { // 键为被生者，值为生者
                '木': '水',
                '火': '木',
                '土': '火',
                '金': '土',
                '水': '金'
            },
            '克': { // 键为克者，值为被克者
                '木': '土',
                '火': '金',
                '土': '水',
                '金': '木',
                '水': '火'
            }
        },
        SEASONAL_POWER: {
            '木': {'旺': ['寅', '卯'], '相': ['辰'], '休': ['巳', '午', '未'], '囚': ['申', '酉', '戌'], '死': ['亥', '子', '丑']},
            '火': {'旺': ['巳', '午'], '相': ['未'], '休': ['申', '酉', '戌'], '囚': ['亥', '子', '丑'], '死': ['寅', '卯', '辰']},
            '金': {'旺': ['申', '酉'], '相': ['戌'], '休': ['亥', '子', '丑'], '囚': ['寅', '卯', '辰'], '死': ['巳', '午', '未']},
            '水': {'旺': ['亥', '子'], '相': ['丑'], '休': ['寅', '卯', '辰'], '囚': ['巳', '午', '未'], '死': ['申', '酉', '戌']},
            '土': {'旺': ['辰', '戌', '丑', '未'], '相': ['巳', '午'], '休': ['申', '酉'], '囚': ['亥', '子'], '死': ['寅', '卯']} // 土的简化处理
        },
        SEASONAL_SCORES: {'旺': 5, '相': 3, '休': 1, '囚': 0, '死': -2}
    };

    // 模块：干支相关计算
    const _ganzhiModule = {
        init: function() {
            if (_constants.JIAZI.length > 0) return;
            // 生成60甲子表
            for (let i = 0; i < 60; i++) {
                const gan = _constants.TIAN_GAN[i % 10];
                const zhi = _constants.DI_ZHI[i % 12];
                _constants.JIAZI.push(gan + zhi);
            }
        },
        // 根据索引获取干支
        getFromIndex: function(index) {
            const safeIndex = (index % 60 + 60) % 60; // 确保索引为正数
            return _constants.JIAZI[safeIndex];
        },
        // "日上起时法" - 根据日干和时支计算时柱
        getHourPillar: function(dayGanIndex, hourZhiIndex) {
            // 甲己日起甲子时, 乙庚日起丙子时, 丙辛日起戊子时, 丁壬日起庚子时, 戊癸日起壬子时
            const startGanIndex = (dayGanIndex % 5) * 2;
            const hourGanIndex = (startGanIndex + hourZhiIndex) % 10;
            return _constants.TIAN_GAN[hourGanIndex] + _constants.DI_ZHI[hourZhiIndex];
        }
    };

    // 模块：天文计算
    const _astroModule = {
        // 节气计算的缓存
        solarTermCache: {},

        // 高阶函数，用于实现缓存（记忆化）
        memoize: function(fn) {
            return (year) => {
                if (this.solarTermCache[year]) {
                    return this.solarTermCache[year];
                }
                const result = fn(year);
                this.solarTermCache[year] = result;
                return result;
            };
        },

        // 公历转儒略日 (Julian Day Number)
        getJDN: function(y, m, d, h, min, s) {
            let a = Math.floor((14 - m) / 12);
            let year = y + 4800 - a;
            let month = m + 12 * a - 3;
            const day = d + Math.floor((153 * month + 2) / 5) +
                365 * year + Math.floor(year / 4) -
                Math.floor(year / 100) + Math.floor(year / 400) - 32045;
            const fraction = (h - 12) / 24 + min / 1440 + s / 86400;
            return day + fraction;
        },

        // 计算太阳的黄经度数（一个精度足够的简化算法）
        getSunEclipticLongitude: function(jdn) {
            const n = jdn - 2451545.0;
            const L = (280.460 + 0.9856474 * n) % 360; // 平黄经
            const g = (357.528 + 0.9856003 * n) % 360; // 平近点角
            const gRad = g * Math.PI / 180;
            // 真黄经 (lambda)
            const lambda = L + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad);
            return (lambda + 360) % 360;
        },

        // 寻找特定节气（太阳到达特定黄经度数）的精确儒略日
        findSolarTermJDN: function(year, targetAngle) {
            // 初始估算一个大概的儒略日
            let jdn_approx = this.getJDN(year, 1, 1, 0, 0, 0) + (targetAngle / 360) * 365.2422;
            // 通过迭代逼近，精确求解
            for (let i = 0; i < 5; i++) {
                const currentAngle = this.getSunEclipticLongitude(jdn_approx);
                let angleDiff = targetAngle - currentAngle;
                // 处理角度跨越360度的情况
                if (angleDiff < -180) angleDiff += 360;
                if (angleDiff > 180) angleDiff -= 360;
                // 根据角度差调整儒略日，0.9856是太阳每日平均移动度数
                jdn_approx += angleDiff / 0.9856;
            }
            return jdn_approx;
        },

        // 计算指定年份的所有24个节气
        calculateAllSolarTerms: function(year) {
            const terms = [];
            // 八字年以立春为界，可能在公历年初，所以需要计算上一年数据以确保完整
            const startYear = year - 1;

            for (let y = startYear; y <= year; y++) {
                for (let i = 0; i < _constants.SOLAR_TERM_ANGLES.length; i++) {
                    const angle = _constants.SOLAR_TERM_ANGLES[i];
                    const termJDN = this.findSolarTermJDN(y, angle);
                    
                    // 过滤掉不需要的过早或过晚的节气，优化数据量
                    const termDate = this.jdnToDate(termJDN, 8); // 使用东八区时间进行粗略检查
                    if (termDate.getFullYear() < year && termDate.getMonth() < 10) continue;
                    if (termDate.getFullYear() > year) continue;

                    terms.push({
                        angle: angle,
                        jdn: termJDN
                    });
                }
            }
            // 按时间顺序排序
            terms.sort((a, b) => a.jdn - b.jdn);
            return terms;
        },
        
        // 儒略日转公历日期对象
        jdnToDate: function(jdn, timezoneOffset) {
            const jdn_utc = jdn - timezoneOffset / 24.0;
            const Z = Math.floor(jdn_utc + 0.5);
            const F = (jdn_utc + 0.5) - Z;
            
            let A;
            if (Z < 2299161) {
                A = Z;
            } else {
                const alpha = Math.floor((Z - 1867216.25) / 36524.25);
                A = Z + 1 + alpha - Math.floor(alpha / 4);
            }

            const B = A + 1524;
            const C = Math.floor((B - 122.1) / 365.25);
            const D = Math.floor(365.25 * C);
            const E = Math.floor((B - D) / 30.6001);

            const day = B - D - Math.floor(30.6001 * E) + F;
            const month = (E < 14) ? E - 1 : E - 13;
            const year = (month > 2) ? C - 4716 : C - 4715;

            const hours = (day - Math.floor(day)) * 24;
            const minutes = (hours - Math.floor(hours)) * 60;
            const seconds = (minutes - Math.floor(minutes)) * 60;

            return new Date(Date.UTC(year, month - 1, Math.floor(day), Math.floor(hours), Math.floor(minutes), Math.floor(seconds)));
        }
    };
    
    // --- 公开的 Wbazi 类 ---
    
    function Wbazi(year, month, day, hour, minute, second, longitude, gender) {
        this.year = year;
        this.month = month;
        this.day = day;
        this.hour = hour;
        this.minute = minute;
        this.second = second || 0;
        this.longitude = longitude;
        this.gender = gender; // 性别: '男' 或 '女'

        // 初始化模块
        _ganzhiModule.init();
        // 对节气计算函数应用缓存
        _astroModule.calculateAllSolarTerms = _astroModule.memoize(_astroModule.calculateAllSolarTerms.bind(_astroModule));

        // 执行核心计算
        this._calculate();
    }

    Wbazi.prototype._calculate = function() {
        // 1. 计算真太阳时
        const date = new Date(this.year, this.month - 1, this.day, this.hour, this.minute, this.second);
        // 客户端所在时区与UTC的小时差
        const timezoneOffset = date.getTimezoneOffset() / -60; 
        // 客户端时区的中央经线
        const timeZoneMeridian = timezoneOffset * 15;

        // 经度差修正 (分钟)
        const longitudeCorrection = (this.longitude - timeZoneMeridian) * 4;

        // 真平太阳时差 (Equation of Time) 修正 (分钟)
        const jdn_utc = _astroModule.getJDN(this.year, this.month, this.day, this.hour, this.minute, this.second) - timezoneOffset/24;
        const sunLon = _astroModule.getSunEclipticLongitude(jdn_utc);
        const jdn_spring_equinox = _astroModule.findSolarTermJDN(this.year, 0); // 春分点
        const daysSinceEquinox = jdn_utc - jdn_spring_equinox;
        const B = (360 / 365.2422) * daysSinceEquinox * (Math.PI / 180);
        const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

        const totalCorrectionMinutes = longitudeCorrection + eot;
        const trueSolarTime = new Date(date.getTime() + totalCorrectionMinutes * 60 * 1000);
        
        this.trueSolarTime = trueSolarTime; // 保存真太阳时以备后用
        
        // 使用UTC方法提取真太阳时的日期和时间组件
        const tst_year = trueSolarTime.getUTCFullYear();
        const tst_month = trueSolarTime.getUTCMonth() + 1;
        const tst_day = trueSolarTime.getUTCDate();
        const tst_hour = trueSolarTime.getUTCHours();
        const tst_min = trueSolarTime.getUTCMinutes();
        const tst_sec = trueSolarTime.getUTCSeconds();

        // 计算真太阳时对应的儒略日 (基于提取的UTC组件)
        const trueSolarJDN = _astroModule.getJDN(tst_year, tst_month, tst_day, tst_hour, tst_min, tst_sec);

        // 2. 获取当年的节气数据
        const solarTerms = _astroModule.calculateAllSolarTerms(this.year);
        
        // --- 开始确定四柱 ---
        
        // a) 年柱
        // 找到当年的立春 (黄经315度)
        let lichunJDN = solarTerms.find(term => term.angle === 315 && _astroModule.jdnToDate(term.jdn, 0).getUTCFullYear() === this.year)?.jdn;
        if (!lichunJDN) { // 如果立春在1月或2月，它可能是在前一年的计算结果中
             const prevYearTerms = _astroModule.calculateAllSolarTerms(this.year - 1);
             lichunJDN = prevYearTerms.find(term => term.angle === 315)?.jdn;
        }
        // 如果出生时间早于立春，则算作上一年
        let baziYear = trueSolarJDN >= lichunJDN ? this.year : this.year - 1;
        this.yearPillar = _ganzhiModule.getFromIndex(baziYear - 4);

        // b) 月柱
        // 查找出生时间所属的节（注意是“节”而不是“气”）
        const jieqi = solarTerms.filter(term => term.angle % 30 === 15).reverse(); // 修正为节 (angle % 30 === 15)
        let monthZhiIndex = 0;
        for (const term of jieqi) {
            if (trueSolarJDN >= term.jdn) {
                // 黄经度数转地支索引: 修正映射逻辑
                const adjustedAngle = (term.angle - 315 + 360) % 360;
                monthZhiIndex = (Math.floor(adjustedAngle / 30) + 2) % 12;
                break;
            }
        }
        const yearGanIndex = (baziYear - 4) % 10;
        // 月干公式: 使用五虎遁正确计算
        const startGanForYin = ((yearGanIndex % 5) * 2 + 2) % 10;
        const baziMonthNum = (monthZhiIndex - 2 + 12) % 12 + 1;
        const monthGanIndex = (startGanForYin + baziMonthNum - 1) % 10;
        this.monthPillar = _constants.TIAN_GAN[monthGanIndex] + _constants.DI_ZHI[monthZhiIndex];

        // c) 日柱
        // 日柱的计算基于真太阳时的日期 (日界为子正，即真太阳时午夜)
        const jdnForDayPillar = Math.floor(trueSolarJDN - 0.5);
        const dayOffset = jdnForDayPillar - Math.floor(_constants.EPOCH_JD - 0.5);
        const dayIndex = _constants.EPOCH_DAY_GANZHI_INDEX + dayOffset;
        this.dayPillar = _ganzhiModule.getFromIndex(dayIndex);

        // d) 时柱
        const dayGanIndexOfPillar = (_constants.JIAZI.indexOf(this.dayPillar)) % 10;
        // 根据真太阳时的小时确定时辰地支 (特殊处理23点-24点为次日子时)
        const hourZhiIndex = Math.floor((tst_hour + 1) / 2) % 12;
        this.hourPillar = _ganzhiModule.getHourPillar(dayGanIndexOfPillar, hourZhiIndex);
    };
    
    /**
     * 获取计算出的生辰八字
     * @returns {string[]} 一个包含四柱干支的数组 [年柱, 月柱, 日柱, 时柱]
     */
    Wbazi.prototype.getBazi = function() {
        return [this.yearPillar, this.monthPillar, this.dayPillar, this.hourPillar];
    };
    
    /**
     * 计算身强身弱，返回0-10的整数，0为极弱，10为极强
     * @returns {number} 身强身弱指数
     */
    Wbazi.prototype.getBodyStrength = function() {
        const pillars = [this.yearPillar, this.monthPillar, this.dayPillar, this.hourPillar];
        const gans = pillars.map(p => p[0]);
        const zhis = pillars.map(p => p[1]);
        const day_gan = gans[2];
        const day_wu = _constants.FIVE_ELEMENTS_GAN[day_gan];
        const month_zhi = zhis[1];

        // 计算五行关系函数
        const get_wuxing_relation = (day_wu, other_wu) => {
            if (day_wu === other_wu) return '比';
            if (_constants.WUXING_RELATIONS['生'][day_wu] === other_wu) return '印';
            if (_constants.WUXING_RELATIONS['生'][other_wu] === day_wu) return '食';
            if (_constants.WUXING_RELATIONS['克'][day_wu] === other_wu) return '财';
            if (_constants.WUXING_RELATIONS['克'][other_wu] === day_wu) return '官';
            return null;
        };

        // 藏干权重函数
        const get_hidden_weights = (length) => {
            if (length === 1) return [1];
            if (length === 2) return [0.7, 0.3];
            if (length === 3) return [0.6, 0.25, 0.15];
            return [];
        };

        let same_class_score = 0;
        let diff_class_score = 0;

        // 天干得分（年、月、时干，不包括日干）
        [0, 1, 3].forEach(idx => {
            const other_gan = gans[idx];
            const other_wu = _constants.FIVE_ELEMENTS_GAN[other_gan];
            const rel = get_wuxing_relation(day_wu, other_wu);
            if (['比', '印'].includes(rel)) {
                same_class_score += 1;
            } else {
                diff_class_score += 1;
            }
        });

        // 地支得分（所有地支，包括藏干）
        zhis.forEach((zhi, idx) => {
            const hidden = _constants.HIDDEN_GANS[zhi] || [];
            const weights = get_hidden_weights(hidden.length);
            let branch_weight_multiplier = (idx === 1) ? 2 : 1; // 月支权重翻倍
            hidden.forEach((h_gan, h_idx) => {
                const h_wu = _constants.FIVE_ELEMENTS_GAN[h_gan];
                const rel = get_wuxing_relation(day_wu, h_wu);
                const weight = weights[h_idx] * branch_weight_multiplier;
                if (['比', '印'].includes(rel)) {
                    same_class_score += weight;
                } else {
                    diff_class_score += weight;
                }
            });
        });

        // 季节调整得分
        let seasonal_score = 0;
        for (const [power, zhi_list] of Object.entries(_constants.SEASONAL_POWER[day_wu])) {
            if (zhi_list.includes(month_zhi)) {
                seasonal_score = _constants.SEASONAL_SCORES[power];
                break;
            }
        }
        if (seasonal_score > 0) {
            same_class_score += seasonal_score;
        } else {
            diff_class_score += Math.abs(seasonal_score);
        }

        // 计算强度指数
        const total = same_class_score + diff_class_score;
        const strength = (total > 0) ? (same_class_score / total) * 10 : 0;
        return Math.round(strength);
    };
    
    // 返回 Wbazi 类
    return Wbazi;
}));