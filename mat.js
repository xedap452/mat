const axios = require('axios');
const { parse } = require('querystring');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const colors = require('colors');
const { DateTime } = require('luxon');

const headers = {
    "host": "tgapp-api.matchain.io",
    "connection": "keep-alive",
    "accept": "application/json, text/plain, */*",
    "user-agent": "Mozilla/5.0 (Linux; Android 10; Redmi 4A / 5A Build/QQ3A.200805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.185 Mobile Safari/537.36",
    "content-type": "application/json",
    "origin": "https://tgapp.matchain.io",
    "x-requested-with": "tw.nekomimi.nekogram",
    "sec-fetch-site": "same-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "referer": "https://tgapp.matchain.io/",
    "accept-language": "en,en-US;q=0.9"
};

class Matchain {
    constructor() {
        this.headers = { ...headers };
        this.autogame = true;
    }

    async http(url, headers, data = null) {
        while (true) {
            try {
                const res = data ? await axios.post(url, data, { headers }) : await axios.get(url, { headers });
                return res;
            } catch (error) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    log(msg, level = 'info') {
        const levels = {
            info: 'cyan',
            success: 'green',
            warning: 'yellow',
            error: 'red'
        };
        console.log(`[*] ${msg}`[levels[level]]);
    }

    dancay(data) {
        const params = new URLSearchParams(data);
        const parsedData = {};
        for (const [key, value] of params.entries()) {
            parsedData[key] = value;
        }
        return parsedData;
    }

    async login(data) {
        const parser = this.dancay(data);
        const userEncoded = decodeURIComponent(parser['user']);
        let user;
        try {
            user = JSON.parse(userEncoded);
        } catch (error) {
            this.log('Không thể phân tích JSON', 'error');
            return false;
        }
    
        const url = "https://tgapp-api.matchain.io/api/tgapp/v1/user/login";
        const payload = JSON.stringify({
            "uid": user['id'],
            "first_name": user['first_name'],
            "last_name": user['last_name'],
            "username": user['username'],
            "tg_login_params": data
        });
    
        let res = await this.http(url, this.headers, payload);
        if (res.status !== 200) {
            this.log(`Đăng nhập không thành công! Status: ${res.status}`, 'error');
            return false;
        }
    
        if (!res.data || !res.data.data || !res.data.data.token) {
            this.log('Không tìm thấy token!', 'error');
            return false;
        }
    
        this.userid = user['id'];
        this.log('Đăng nhập thành công!', 'success');
        const token = res.data.data.token;
        this.headers['authorization'] = token;
    
        const balanceUrl = "https://tgapp-api.matchain.io/api/tgapp/v1/point/balance";
        res = await this.http(balanceUrl, this.headers, JSON.stringify({ "uid": this.userid }));
        if (res.status !== 200) {
            this.log('Lỗi không lấy được balance!', 'error');
            return false;
        }
    
        const balance = res.data.data;
        this.log(`Balance: ${balance / 1000}`, 'info');
    
        let next_claim = 0;
        while (true) {
            const rewardUrl = "https://tgapp-api.matchain.io/api/tgapp/v1/point/reward";
            res = await this.http(rewardUrl, this.headers, JSON.stringify({ "uid": this.userid }));
            if (res.status !== 200) {
                this.log('Error, check response!', 'error');
                return false;
            }
    
            next_claim = res.data.data.next_claim_timestamp;
            console.log(next_claim);
            if (next_claim === 0) {
                const farmingUrl = "https://tgapp-api.matchain.io/api/tgapp/v1/point/reward/farming";
                res = await this.http(farmingUrl, this.headers, JSON.stringify({ "uid": this.userid }));
                if (res.status !== 200) {
                    this.log('Error, check response!', 'error');
                    return false;
                }
                continue;
            }
    
            if (next_claim > Date.now()) {
                const format_next_claim = DateTime.fromMillis(next_claim).toFormat('yyyy-MM-dd HH:mm:ss');
                this.log('Đang trong trạng thái farming!', 'warning');
                this.log(`Thời gian hoàn thành farming: ${format_next_claim}`, 'info');
                break; 
            }
    
            const claimUrl = "https://tgapp-api.matchain.io/api/tgapp/v1/point/reward/claim";
            res = await this.http(claimUrl, this.headers, JSON.stringify({ "uid": this.userid }));
            if (res.status !== 200) {
                this.log('Nhận phần thưởng thất bại!', 'error');
                return false;
            }
    
            const _data = res.data.data;
            this.log('Phần thưởng đã được nhận thành công', 'success');
            this.log(`Balance: ${balance + _data}`, 'info');
            break;
        }
    
        const taskNames = await this.getTaskList(user['id']);
        for (let taskType of taskNames) {
            await this.completeTask(user['id'], taskType);
        }
    
        const gameUrl = "https://tgapp-api.matchain.io/api/tgapp/v1/game/play";
        while (true) {
            res = await this.http(gameUrl, this.headers);
            if (res.status !== 200) {
                this.log('Lỗi bắt đầu trò chơi!', 'error');
                return false;
            }
    
            const game_id = res.data.data.game_id;
            const game_count = res.data.data.game_count;
            this.log(`Vé trò chơi: ${game_count}`, 'info');
            if (game_count <= 0) {
                this.log('Không còn vé trò chơi!', 'warning');
                break; 
            }
    
            await this.countdown(30);
            const point = Math.floor(Math.random() * (150 - 100 + 1)) + 100;
            const payload = JSON.stringify({ "game_id": game_id, "point": point });
            const url_claim = "https://tgapp-api.matchain.io/api/tgapp/v1/game/claim";
            res = await this.http(url_claim, this.headers, payload);
            if (res.status !== 200) {
                this.log('Không thể bắt đầu trò chơi!', 'error');
                continue;
            }
    
            this.log(`Hoàn thành trò chơi, kếm được: ${point}`, 'success');
        }
    
        return Math.round(next_claim / 1000 - Date.now() / 1000) + 30;
    }
    

    load_data(file) {
        const data = fs.readFileSync(file, 'utf-8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== '');

        if (data.length === 0) {
            this.log('Không tìm thấy tài khoản nào!', 'warning');
            return false;
        }

        return data;
    }

    async getTaskList(uid) {
        const url = "https://tgapp-api.matchain.io/api/tgapp/v1/point/task/list";
        const payload = JSON.stringify({ "uid": uid });

        let res = await this.http(url, this.headers, payload);
        if (res.status !== 200) {
            this.log(`Lỗi khi lấy danh sách nhiệm vụ! Status: ${res.status}`, 'error');
            return false;
        }

        const data = res.data.data;

        if (!data || !Array.isArray(data.Tasks)) {
            this.log('Dữ liệu không hợp lệ', 'error');
            return false;
        }

        const extraTasks = Array.isArray(data['Extra Tasks']) ? data['Extra Tasks'] : [];
        const allTasks = [...data.Tasks, ...extraTasks];
        const filteredTasks = allTasks.filter(task => task.complete === false && task.name !== "join_match_group");
        const taskNames = filteredTasks.map(task => task.name);
        return taskNames;
    }

    async completeTask(uid, taskType) {
        const url = "https://tgapp-api.matchain.io/api/tgapp/v1/point/task/complete";
        const payload = JSON.stringify({ "uid": uid, "type": taskType });
    
        let res = await this.http(url, this.headers, payload);
        if (res.status !== 200) {
            this.log(`Lỗi khi hoàn thành nhiệm vụ ${taskType}! Status: ${res.status}`, 'error');
            this.log(`Response: ${JSON.stringify(res.data)}`, 'error');
            return false;
        }
    
        const rewardClaimed = await this.claimReward(uid, taskType);
        return rewardClaimed;
    }
    
    async claimReward(uid, taskType) {
        const url = "https://tgapp-api.matchain.io/api/tgapp/v1/point/task/claim";
        const payload = JSON.stringify({ "uid": uid, "type": taskType });
    
        let res = await this.http(url, this.headers, payload);
        if (res.status !== 200) {
            this.log(`Lỗi khi nhận phần thưởng nhiệm vụ ${taskType}! Status: ${res.status}`, 'error');
            this.log(`Response: ${JSON.stringify(res.data)}`, 'error');
            return false;
        }
    
        if (res.data.code === 200 && res.data.data === 'success') {
            this.log(`${'Làm nhiệm vụ'.yellow} ${taskType.white} ... ${'Trạng thái:'.white} ${'Hoàn thành'.green}`);
        } else {
            this.log(`${'Làm nhiệm vụ'.yellow} ${taskType.white} ... ${'Trạng thái:'.white} ${'Thất bại'.red}`);
            this.log(`Response: ${JSON.stringify(res.data)}`, 'error');
            return false;
        }
    
        return true;
    }
    
    

    async main() {
        const args = require('minimist')(process.argv.slice(2));
        if (!args['--marin']) {
            if (os.platform() === 'win32') {
                execSync('cls', { stdio: 'inherit' });
            } else {
                execSync('clear', { stdio: 'inherit' });
            }
        }
        this.autogame = true;

        while (true) {
            const list_countdown = [];
            const start = Math.floor(Date.now() / 1000);
            for (let [no, data] of this.load_data(args['--data'] || 'data.txt').entries()) {
                const parser = this.dancay(data);
                const userEncoded = decodeURIComponent(parser['user']);
                let user;
                try {
                    user = JSON.parse(userEncoded);
                } catch (error) {
                    this.log('Không thể phân tích JSON', 'error');
                    continue;
                }
                console.log(`========== Tài khoản ${no + 1} | ${user['first_name'].green} ==========`);
                const result = await this.login(data);
                if (!result) continue;

                list_countdown.push(result);
                await this.countdown(3);
            }

            const end = Math.floor(Date.now() / 1000);
            const total = end - start;
            const positiveCountdowns = list_countdown.filter(time => time > total);
            if (positiveCountdowns.length > 0) {
                const min = Math.min(...positiveCountdowns) - total;
                if (min > 0) {
                    await this.countdown(min);
                }
            }
        }
    }

    async countdown(t) {
        while (t) {
            const hours = String(Math.floor(t / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
            const seconds = String(t % 60).padStart(2, '0');
            process.stdout.write(`[*] Chờ ${hours}:${minutes}:${seconds}     \r`.gray);
            await new Promise(resolve => setTimeout(resolve, 1000));
            t -= 1;
        }
        process.stdout.write('\r');
    }
}

if (require.main === module) {
    const app = new Matchain();
    app.main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
