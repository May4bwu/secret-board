'use strict';
const crypto = require('crypto');
const pug = require('pug');
const Cookies = require('cookies');
const moment = require('moment-timezone');
const util = require('./handler-util');
const Post = require('./post');

const trackingIdKey = 'tracking_id';

const oneTimeTokenMap = new Map(); // Key: userName, Value: token

function handle(req, res) {
  const cookies = new Cookies(req, res);
  const trackingId = addTrackingCookie(cookies, req.user);

  switch (req.method) {
    case 'GET':
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      Post.findAll({ order: [['id', 'DESC']] }).then((posts) => {
        posts.forEach((post) => {
          post.content = post.content.replace(/\+/g, ' ');
          post.formattedCreatedAt = moment(post.createdAt).tz('Asia/Tokyo').format('YYYY年MM月DD日 HH時mm分ss秒');
        });
        const oneTimeToken = crypto.randomBytes(8).toString('hex');
        oneTimeTokenMap.set(req.user, oneTimeToken);
        res.end(pug.renderFile('./views/posts.pug', {
          posts: posts,
          user: req.user,
          oneTimeToken: oneTimeToken
        }));
        console.info(
          `閲覧されました: user: ${req.user}, ` +
          `trackingId: ${trackingId},` +
          `remoteAddress: ${req.connection.remoteAddress}, ` +
          `userAgent: ${req.headers['user-agent']}`
        );
      });
      break;
    case 'POST':
      let body = [];
      req.on('data', chunk => {
        body.push(chunk);
      }).on('end', () => {
        body = Buffer.concat(body).toString();
        const decoded = decodeURIComponent(body);
        const matchResult = decoded.match(/content=(.*)&oneTimeToken=(.*)/);
        if (!matchResult) {
          util.handleBadRequest(req, res);
        } else {
          const content = matchResult[1];
          const requestedOneTimeToken = matchResult[2];
          if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
            console.info('投稿されました: ' + content);
            Post.create({
              content: content,
              trackingCookie: trackingId,
              postedBy: req.user
            }).then(() => {
              oneTimeTokenMap.delete(req.user);
              handleRedirectPosts(req, res);
            });
          } else {
            util.handleBadRequest(req, res);
          }
        }
      });
      break;
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

function handleDelete(req, res) {
  switch (req.method) {
    case 'POST':
      let body = [];
      req.on('data', (chunk) => {
        body.push(chunk);
      }).on('end', () => {
        body = Buffer.concat(body).toString();
        const decoded = decodeURIComponent(body);
        const dataArray = decoded.split('&');
      const id = dataArray[0] ? dataArray[0].split('id=')[1] : '';
      const requestedOneTimeToken = dataArray[1] ? dataArray[1].split('oneTimeToken=')[1] : '';
      if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
        Post.findByPk(id).then((post) => {
          if (req.user === post.postedBy || req.user === 'admin') {
            post.destroy().then(() => {
              console.info(
                `削除されました: user: ${req.user}, ` +
                `remoteAddress: ${req.connection.remoteAddress}, ` +
                `userAgent: ${req.headers['user-agent']} `
              );
              oneTimeTokenMap.delete(req.user);
              handleRedirectPosts(req, res);
            });
          }
        });
      } else {
        util.handleBadRequest(req, res);
      }
      });
      break;
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

/**
 * Cookie に含まれているトラッキングIDに異常がなければその値を返し、
 * 存在しない場合や異常なものである場合には、再度生成し Cookie に付与してその値を返す
 * @param {Cookies} cookies
 * @param {String} userName
 * @return {String} TrackingID
 */

function addTrackingCookie(cookies, userName) {
  const requestedTrackingId = cookies.get(trackingIdKey);
  if (isValidTrackingId(requestedTrackingId, userName)) {
    return requestedTrackingId;
  } else {
    const originalId = parseInt(crypto.randomBytes(8).toString('hex'), 16);
    const tomorrow = new Date(Date.now() + (1000 * 60 * 60 * 24));
    const trackingId = originalId + '_' + createValidHash(originalId, userName);
    cookies.set(trackingIdKey, trackingId, { expires: tomorrow });
    return trackingId;
  }
}

function isValidTrackingId(trackingId, userName) {
  if (!trackingId) {
    return false;
  }
  const splitted = trackingId.split('_');
  const originalId = splitted[0];
  const requestedHash = splitted[1];
  return createValidHash(originalId, userName) === requestedHash;
}

const secretKey =
  '71a05fd04174f16e67fa115b672fc9422ed84c4db3efe389f3f30f63869c98e7db0048d176c5f5e7ebe9ad25694aa3832eb7ef1c3a7ede2bf006d07cfaa530beb5540f452118e441b9f8da7d357023382f2a5494eadcbaf48cbb519ab2e696662f26d46fc7024e64f41f293be7359e5fd14a992da4b9725d85763915deb68e1e7bfc845cc753068dcf2f061f4c9b98404f34115bee49371e5599c76a80110c9fe42967e69f925c1f3ab957fbf18877fd7d23ca2f5eb132ee194e644b13cecdc22a35007d0464ba19580bef3bbd984f4b366f7aacd78ce592feaca16a2906e0f1afe08fb2882cdd2bfa5c46cd56bee80d1ac38010b06d80471a58cc92a75648ae'

function createValidHash(originalId, userName) {
  const sha1sum = crypto.createHash('sha1');
  sha1sum.update(originalId + userName + secretKey);
  return sha1sum.digest('hex');
}

function handleRedirectPosts(req, res) {
  res.writeHead(303, {
    Location: '/posts'
  });
  res.end();
}

module.exports = {
  handle,
  handleDelete
};

