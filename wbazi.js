(function(window) {
    'use strict';

    // -------------------------------------------------------------------------
    // 内部模块：常量定义 (Constants)
    // -------------------------------------------------------------------------
    const Constants = {
        // 天干
        HEAVENLY_STEMS: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
        // 地支
        EARTHLY_BRANCHES: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],
        // 儒略日计算基准 (J2000.0)
        JD_EPOCH: 2451545.0,
        // 日柱计算基准：2000年1月1日 12:00 UT (庚辰日)
        // (2451545 - 0.5) % 60 = 36 (庚辰)
        DAY_PILLAR_EPOCH_JD: 2451545.0,
        DAY_PILLAR_EPOCH_INDEX: 36, // 庚辰在60甲子中的索引 (从0开始)
        // 年柱计算基准：2000年是庚辰年
        YEAR_PILLAR_EPOCH_GREGORIAN: 2000,
        YEAR_PILLAR_EPOCH_INDEX: 16, // 庚辰在60甲子中的索引
        // 24节气对应的太阳黄经度数
        SOLAR_TERMS_LONGITUDE: [
            315, 330, 345, 0, 15, 30, 45, 60, 75, 90, 105, 120,
            135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300
        ],
        // 月柱天干速查表 (年干索引 -> 月支索引 -> 月干索引)
        MONTH_STEM_LOOKUP: , // 甲己年
            , // 乙庚年
            , // 丙辛年
            , // 丁壬年
              // 戊癸年
        ],
        // 时柱天干速查表 (日干索引 -> 时支索引 -> 时干索引)
        HOUR_STEM_LOOKUP: , // 甲己日
            , // 乙庚日
            , // 丙辛日
            , // 丁壬日
              // 戊癸日
        ]
    };

    // -------------------------------------------------------------------------
    // 内部模块：通用工具 (Utils)
    // -------------------------------------------------------------------------
    const Utils = {
        /**
         * 高阶函数：用于记忆化（缓存）函数计算结果
         * @param {Function} fn - 需要被记忆化的纯函数
         * @returns {Function} - 带有缓存功能的函数
         */
        memoize: function(fn) {
            const cache = {};
            return function(...args) {
                const key = JSON.stringify(args);
                if (cache[key]) {
                    return cache[key];
                }
                const result = fn.apply(this, args);
                cache[key] = result;
                return result;
            };
        },
        /**
         * 将角度转换为弧度
         * @param {number} deg - 角度
         * @returns {number} - 弧度
         */
        degToRad: function(deg) {
            return deg * Math.PI / 180;
        },
        /**
         * 规范化角度到 0-360 范围
         * @param {number} deg - 角度
         * @returns {number} - 规范化后的角度
         */
        normalizeDeg: function(deg) {
            let b = deg / 360;
            let a = 360 * (b - Math.floor(b));
            return a < 0? a + 360 : a;
        }
    };

    // -------------------------------------------------------------------------
    // 内部模块：时间转换器 (TimeConverter)
    // -------------------------------------------------------------------------
    const TimeConverter = {
        /**
         * 将公历日期时间转换为儒略日 (Julian Day)
         * @param {number} year - 年
         * @param {number} month - 月 (1-12)
         * @param {number} day - 日
         * @param {number} hour - 时 (0-23)
         * @param {number} minute - 分 (0-59)
         * @param {number} second - 秒 (0-59)
         * @returns {number} - 儒略日
         */
        gregorianToJD: function(year, month, day, hour, minute, second) {
            if (month <= 2) {
                year -= 1;
                month += 12;
            }
            const A = Math.floor(year / 100);
            const B = 2 - A + Math.floor(A / 4);
            const dayFraction = (hour + minute / 60 + second / 3600) / 24;

            return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5 + dayFraction;
        }
    };

    // -------------------------------------------------------------------------
    // 内部模块：天文计算器 (AstroCalculator)
    // -------------------------------------------------------------------------
    const AstroCalculator = {
        /**
         * 计算均时差 (Equation of Time)
         * @param {number} jd - 儒略日
         * @returns {number} - 均时差（分钟）
         */
        calculateEoT: function(jd) {
            const D = jd - Constants.JD_EPOCH;
            const g = Utils.normalizeDeg(357.529 + 0.98560028 * D);
            const q = Utils.normalizeDeg(280.459 + 0.98564736 * D);
            const L = Utils.normalizeDeg(q + 1.915 * Math.sin(Utils.degToRad(g)) + 0.020 * Math.sin(Utils.degToRad(2 * g)));
            const e = Utils.degToRad(23.439 - 0.00000036 * D);
            let RA = Utils.normalizeDeg(Math.atan2(Math.cos(e) * Math.sin(Utils.degToRad(L)), Math.cos(Utils.degToRad(L))) * 180 / Math.PI);
            
            let delta = q - RA;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;

            return delta * 4; // 1度=4分钟
        },

        /**
         * 计算真太阳时
         * @param {number} year - 年
         * @param {number} month - 月
         * @param {number} day - 日
         * @param {number} hour - 时
         * @param {number} minute - 分
         * @param {number} second - 秒
         * @param {number} longitude - 经度 (东正西负)
         * @returns {Date} - 包含真太阳时的Date对象
         */
        getTrueSolarTime: function(year, month, day, hour, minute, second, longitude) {
            const jd = TimeConverter.gregorianToJD(year, month, day, hour, minute, second);
            const eot = this.calculateEoT(jd); // 分钟
            const longitudeCorrection = longitude * 4; // 分钟
            
            const totalOffsetMinutes = eot + longitudeCorrection;
            
            const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
            const trueSolarTime = new Date(utcDate.getTime() + totalOffsetMinutes * 60 * 1000);
            
            return trueSolarTime;
        },

        /**
         * 计算太阳的黄经 (Ecliptic Longitude)
         * @param {number} jd - 儒略日
         * @returns {number} - 太阳黄经（度）
         */
        getSolarLongitude: function(jd) {
            const n = jd - Constants.JD_EPOCH;
            const L = Utils.normalizeDeg(280.460 + 0.9856474 * n);
            const g = Utils.normalizeDeg(357.528 + 0.9856003 * n);
            const gRad = Utils.degToRad(g);
            const lambda = Utils.normalizeDeg(L + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad));
            return lambda;
        },

        /**
         * 寻找特定太阳黄经对应的儒略日（节气时刻）
         * @param {number} year - 公历年份
         * @param {number} targetLongitude - 目标黄经（度）
         * @returns {number} - 儒略日
         */
        findSolarTermJD: function(year, targetLongitude) {
            // 使用一个近似值开始迭代，通常节气在每月特定日期附近
            let y = year;
            let m = Math.floor(targetLongitude / 30) + 1;
            if (m < 3) y--; // 估算基于3月开始
            let initialJD = TimeConverter.gregorianToJD(y, m, 20, 0, 0, 0);

            let jd = initialJD;
            for (let i = 0; i < 5; i++) { // 迭代5次足以达到高精度
                let currentLon = this.getSolarLongitude(jd);
                let diff = targetLongitude - currentLon;
                // 处理跨越0/360度的情况
                if (diff < -180) diff += 360;
                if (diff > 180) diff -= 360;
                // 太阳每天大约移动1度
                jd += diff;
            }
            return jd;
        }
    };
    // 对节气计算进行记忆化，提高重复查询性能
    AstroCalculator.findSolarTermJD = Utils.memoize(AstroCalculator.findSolarTermJD);


    // -------------------------------------------------------------------------
    // 内部模块：四柱生成器 (PillarGenerator)
    // -------------------------------------------------------------------------
    const PillarGenerator = {
        /**
         * 根据索引获取干支
         * @param {number} index - 在60甲子周期中的索引 (0-59)
         * @returns {{stem: string, branch: string}}
         */
        getGanzhi: function(index) {
            return {
                stem: Constants.HEAVENLY_STEMS[index % 10],
                branch: Constants.EARTHLY_BRANCHES[index % 12]
            };
        },

        /**
         * 计算日柱
         * @param {number} jd - 儒略日
         * @returns {{stem: string, branch: string, index: number}}
         */
        getDayPillar: function(jd) {
            // 中国时区为 UTC+8，日柱以子时为界，需考虑本地午夜
            // JD的整数部分对应UTC中午12点，所以 JD - 0.5 对应UTC午夜0点
            // 加上8小时时区偏移，即 8/24 = 1/3 天
            const chinaJD = jd + 8 / 24;
            const dayNumber = Math.floor(chinaJD - 0.5);
            const diff = dayNumber - Math.floor(Constants.DAY_PILLAR_EPOCH_JD - 0.5);
            const index = (Constants.DAY_PILLAR_EPOCH_INDEX + diff) % 60;
            const adjustedIndex = index < 0? index + 60 : index;
            
            const pillar = this.getGanzhi(adjustedIndex);
            return {...pillar, index: adjustedIndex };
        },

        /**
         * 计算年柱
         * @param {number} birthJD - 出生时刻的儒略日
         * @param {number} gregorianYear - 出生公历年份
         * @returns {{stem: string, branch: string, index: number}}
         */
        getYearPillar: function(birthJD, gregorianYear) {
            const lichunJD = AstroCalculator.findSolarTermJD(gregorianYear, 315); // 立春黄经为315度
            
            let baziYear = gregorianYear;
            if (birthJD < lichunJD) {
                baziYear = gregorianYear - 1;
            }

            const yearDiff = baziYear - Constants.YEAR_PILLAR_EPOCH_GREGORIAN;
            const index = (Constants.YEAR_PILLAR_EPOCH_INDEX + yearDiff) % 60;
            const adjustedIndex = index < 0? index + 60 : index;
            
            const pillar = this.getGanzhi(adjustedIndex);
            return {...pillar, index: adjustedIndex };
        },

        /**
         * 计算月柱
         * @param {number} birthJD - 出生时刻的儒略日
         * @param {number} yearPillarIndex - 年柱的索引
         * @returns {{stem: string, branch: string, index: number}}
         */
        getMonthPillar: function(birthJD, yearPillarIndex) {
            const solarLon = AstroCalculator.getSolarLongitude(birthJD);
            
            // 地支从寅月(index=2)开始，对应330度节气(雨水)到345度(惊蛰)之间
            // 315(立春)到330(雨水)是正月
            let branchIndex;
            if (solarLon >= 315 && solarLon < 345) {
                branchIndex = 2; // 寅月
            } else if (solarLon >= 345 |

| solarLon < 15) {
                branchIndex = 3; // 卯月
            } else {
                branchIndex = Math.floor((solarLon + 15) / 30) + 2;
                if (branchIndex >= 14) branchIndex -= 12;
            }
            
            const yearStemIndex = yearPillarIndex % 10;
            const lookupIndex = Math.floor(yearStemIndex / 2);
            const stemIndex = Constants.MONTH_STEM_LOOKUP[lookupIndex][branchIndex];
            
            return {
                stem: Constants.HEAVENLY_STEMS[stemIndex],
                branch: Constants.EARTHLY_BRANCHES[branchIndex],
                index: stemIndex * 10 + branchIndex // Not a standard Ganzhi index, just for data
            };
        },

        /**
         * 计算时柱
         * @param {Date} trueSolarTime - 真太阳时
         * @param {number} dayPillarIndex - 日柱的索引
         * @returns {{stem: string, branch: string, index: number}}
         */
        getHourPillar: function(trueSolarTime, dayPillarIndex) {
            const hour = trueSolarTime.getUTCHours();
            const branchIndex = Math.floor((hour + 1) / 2) % 12;

            const dayStemIndex = dayPillarIndex % 10;
            const lookupIndex = Math.floor(dayStemIndex / 2);
            const stemIndex = Constants.HOUR_STEM_LOOKUP[lookupIndex][branchIndex];

            return {
                stem: Constants.HEAVENLY_STEMS[stemIndex],
                branch: Constants.EARTHLY_BRANCHES[branchIndex],
                index: stemIndex * 10 + branchIndex // Not a standard Ganzhi index
            };
        }
    };


    // -------------------------------------------------------------------------
    // 公开类：WBazi
    // -------------------------------------------------------------------------
    class WBazi {
        /**
         * WBazi 构造函数
         * @param {number} year - 公历年
         * @param {number} month - 公历月 (1-12)
         * @param {number} day - 公历日 (1-31)
         * @param {number} hour - 本地时间小时 (0-23)
         * @param {number} minute - 本地时间分钟 (0-59)
         * @param {number} second - 本地时间秒 (0-59)
         * @param {number} longitude - 出生地经度 (东正西负)
         */
        constructor(year, month, day, hour, minute, second, longitude) {
            this.input = { year, month, day, hour, minute, second, longitude };
            this.pillars = this._calculateAllPillars();
        }

        _calculateAllPillars() {
            const { year, month, day, hour, minute, second, longitude } = this.input;

            // 1. 计算儒略日
            const birthJD = TimeConverter.gregorianToJD(year, month, day, hour, minute, second);
            
            // 2. 计算真太阳时
            const trueSolarTime = AstroCalculator.getTrueSolarTime(year, month, day, hour, minute, second, longitude);

            // 3. 计算四柱
            const dayPillar = PillarGenerator.getDayPillar(birthJD);
            const yearPillar = PillarGenerator.getYearPillar(birthJD, year);
            const monthPillar = PillarGenerator.getMonthPillar(birthJD, yearPillar.index);
            const hourPillar = PillarGenerator.getHourPillar(trueSolarTime, dayPillar.index);

            return {
                year: { stem: yearPillar.stem, branch: yearPillar.branch },
                month: { stem: monthPillar.stem, branch: monthPillar.branch },
                day: { stem: dayPillar.stem, branch: dayPillar.branch },
                hour: { stem: hourPillar.stem, branch: hourPillar.branch }
            };
        }

        /**
         * 以对象形式获取四柱
         * @returns {{year: {stem, branch}, month: {stem, branch}, day: {stem, branch}, hour: {stem, branch}}}
         */
        getPillars() {
            return this.pillars;
        }

        /**
         * 以文本数组形式获取八字
         * @returns {string} - ['年干', '年支', '月干', '月支', '日干', '日支', '时干', '时支']
         */
        getBazi() {
            return [
                this.pillars.year.stem, this.pillars.year.branch,
                this.pillars.month.stem, this.pillars.month.branch,
                this.pillars.day.stem, this.pillars.day.branch,
                this.pillars.hour.stem, this.pillars.hour.branch
            ];
        }
    }

    // 将 WBazi 类挂载到全局对象上
    if (typeof window!== 'undefined') {
        window.WBazi = WBazi;
    }

})(typeof window!== 'undefined'? window : this);